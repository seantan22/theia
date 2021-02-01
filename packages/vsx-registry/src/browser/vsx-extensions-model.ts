/********************************************************************************
 * Copyright (C) 2020 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject, postConstruct } from 'inversify';
import debounce from 'p-debounce';
import * as showdown from 'showdown';
import * as sanitize from 'sanitize-html';
import { Emitter } from '@theia/core/lib/common/event';
import { CancellationToken, CancellationTokenSource } from '@theia/core/lib/common/cancellation';
import { VSXRegistryAPI, VSXResponseError } from '../common/vsx-registry-api';
import { VSXSearchParam, VSXSearchResult } from '../common/vsx-registry-types';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/browser/hosted-plugin';
import { VSXExtension, VSXExtensionFactory } from './vsx-extension';
import { ProgressService } from '@theia/core/lib/common/progress-service';
import { VSXExtensionsSearchModel } from './vsx-extensions-search-model';
import { Deferred } from '@theia/core/lib/common/promise-util';

@injectable()
export class VSXExtensionsModel {

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange = this.onDidChangeEmitter.event;

    protected readonly onDidResultsEmitter = new Emitter<number>();
    readonly onDidResults = this.onDidResultsEmitter.event;

    @inject(VSXRegistryAPI)
    protected readonly api: VSXRegistryAPI;

    @inject(HostedPluginSupport)
    protected readonly pluginSupport: HostedPluginSupport;

    @inject(VSXExtensionFactory)
    protected readonly extensionFactory: VSXExtensionFactory;

    @inject(ProgressService)
    protected readonly progressService: ProgressService;

    @inject(VSXExtensionsSearchModel)
    readonly search: VSXExtensionsSearchModel;

    protected readonly initialized = new Deferred<void>();

    @postConstruct()
    protected async init(): Promise<void> {
        // await Promise.all([
        //     this.initInstalled(),
        //     this.initSearchResult()
        // ]);
        this.initInstalled();
        this.initSearchResult();
        this.initialized.resolve();
    }

    protected async initInstalled(): Promise<void> {
        await this.pluginSupport.willStart;
        this.pluginSupport.onDidChangePlugins(() => {
            this.updateInstalled();
            this._defaultInstalled = this._installed;
        });
        try {
            await this.updateInstalled();
            this._defaultInstalled = this._installed;
            await this.updateSearchResult();
        } catch (e) {
            console.error(e);
        }
    }

    protected async initSearchResult(): Promise<void> {
        this.search.onDidChangeQuery(() => this.updateSearchResult());
        try {
            await this.updateSearchResult();
        } catch (e) {
            console.error(e);
        }
    }

    /**
     * single source of all extensions
     */
    protected readonly extensions = new Map<string, VSXExtension>();

    protected _installed = new Set<string>();
    get installed(): IterableIterator<string> {
        return this._installed.values();
    }

    protected _defaultInstalled = new Set<string>();

    protected _searchResult = new Set<string>();
    get searchResult(): IterableIterator<string> {
        return this._searchResult.values();
    }

    getExtension(id: string): VSXExtension | undefined {
        return this.extensions.get(id);
    }

    protected setExtension(id: string): VSXExtension {
        let extension = this.extensions.get(id);
        if (!extension) {
            extension = this.extensionFactory({ id });
            this.extensions.set(id, extension);
        }
        return extension;
    }

    protected doChange<T>(task: () => Promise<T>): Promise<T>;
    protected doChange<T>(task: () => Promise<T>, token: CancellationToken): Promise<T | undefined>;
    protected doChange<T>(task: () => Promise<T>, token: CancellationToken = CancellationToken.None): Promise<T | undefined> {
        return this.progressService.withProgress('', 'extensions', async () => {
            if (token && token.isCancellationRequested) {
                return undefined;
            }
            const result = await task();
            if (token && token.isCancellationRequested) {
                return undefined;
            }
            this.onDidChangeEmitter.fire(undefined);
            return result;
        });
    }

    protected searchCancellationTokenSource = new CancellationTokenSource();
    protected updateSearchResult = debounce(() => {
        this.searchCancellationTokenSource.cancel();
        this.searchCancellationTokenSource = new CancellationTokenSource();
        const query = this.search.query;
        return this.doUpdateSearchResult({ query, includeAllVersions: true }, this.searchCancellationTokenSource.token);
    }, 150);
    protected doUpdateSearchResult(param: VSXSearchParam, token: CancellationToken): Promise<void> {
        return this.doChange(async () => {
            if (token.isCancellationRequested || param.query === undefined) {
                return;
            }
            if (param.query === '') {
                this._installed = this._defaultInstalled;
            } else if (this.isPrefixQuery(param.query)) {
                this.filterLocalExtensions(param.query);
            } else {
                const result = await this.api.search(param);
                this.getSearchResults(result);
            }
        }, token);
    }

    /**
     *  Get local extensions that satisfy the search query.
     *
     * @param query the search query.
     */
    protected filterLocalExtensions(query: string): void {
        const plugins = this.pluginSupport.plugins;
        const prefix = this.getPrefix(query);
        const modifiedQuery = query.replace(prefix, '').trim().toLowerCase();
        const installed = new Set<string>();
        for (const plugin of plugins) {
            const id = plugin.model.id;
            const extension = this.getExtension(id);
            if (!extension) {
                continue;
            }
            if (this.isBuiltInPrefix(prefix) && extension.builtin) {
                this.matchResults(extension, modifiedQuery, installed);
            } else if (this.isInstalledPrefix(prefix)) {
                this.matchResults(extension, modifiedQuery, installed);
            }

        }
        this._installed = installed;

        if (this.isInstalledPrefix(query) || this.isBuiltInPrefix(query)) {
            this.onDidResultsEmitter.fire(this._installed.size);
        }
    }

    /**
     * Add an extension to results if it satisfies the query based on id, name or description.
     *
     * @param extension the vsx extension.
     * @param query the search query.
     * @param results the set of results.
     */
    protected matchResults(extension: VSXExtension, query: string, results: Set<string>): void {
        const name = extension.displayName;
        const description = extension.description;
        if (!name || !description) {
            return;
        }
        if (extension.id.toLowerCase().indexOf(query) > -1
            || name.toLowerCase().indexOf(query) > -1
            || description.toLowerCase().indexOf(query) > -1) {
            results.add(extension.id);
        }
    }

    /**
     *  Get Open-VSX Registry extensions that satisfy the search query.
     *
     * @param query the search query.
     */
    protected getSearchResults(result: VSXSearchResult): void {
        const searchResult = new Set<string>();
        for (const data of result.extensions) {
            const id = data.namespace.toLowerCase() + '.' + data.name.toLowerCase();
            const extension = this.api.getLatestCompatibleVersion(data.allVersions);
            if (!extension) {
                continue;
            }
            this.setExtension(id).update(Object.assign(data, {
                publisher: data.namespace,
                downloadUrl: data.files.download,
                iconUrl: data.files.icon,
                readmeUrl: data.files.readme,
                licenseUrl: data.files.license,
                version: extension.version
            }));
            searchResult.add(id);
        }
        this._searchResult = searchResult;

        this.onDidResultsEmitter.fire(this._searchResult.size);
    }

    /**
     * Gets all installed extensions including built-ins.
     */
    protected async updateInstalled(): Promise<void> {
        return this.doChange(async () => {
            const plugins = this.pluginSupport.plugins;
            const installed = new Set<string>();
            const refreshing = [];
            for (const plugin of plugins) {
                if (plugin.model.engine.type === 'vscode') {
                    const id = plugin.model.id;
                    this._installed.delete(id);
                    const extension = this.setExtension(id);
                    installed.add(extension.id);
                    refreshing.push(this.refresh(id));
                }
            }
            for (const id of this._installed) {
                refreshing.push(this.refresh(id));
            }
            Promise.all(refreshing);
            const installedSorted = Array.from(installed).sort((a, b) => this.compareExtensions(a, b));
            this._installed = new Set(installedSorted.values());
        });
    }

    resolve(id: string): Promise<VSXExtension> {
        return this.doChange(async () => {
            await this.initialized.promise;
            const extension = await this.refresh(id);
            if (!extension) {
                throw new Error(`Failed to resolve ${id} extension.`);
            }
            if (extension.readmeUrl) {
                try {
                    const rawReadme = await this.api.fetchText(extension.readmeUrl);
                    const readme = this.compileReadme(rawReadme);
                    extension.update({ readme });
                } catch (e) {
                    if (!VSXResponseError.is(e) || e.statusCode !== 404) {
                        console.error(`[${id}]: failed to compile readme, reason:`, e);
                    }
                }
            }
            return extension;
        });
    }

    protected compileReadme(readmeMarkdown: string): string {
        const markdownConverter = new showdown.Converter({
            noHeaderId: true,
            strikethrough: true,
            headerLevelStart: 2
        });

        const readmeHtml = markdownConverter.makeHtml(readmeMarkdown);
        return sanitize(readmeHtml, {
            allowedTags: sanitize.defaults.allowedTags.concat(['h1', 'h2', 'img'])
        });
    }

    protected async refresh(id: string): Promise<VSXExtension | undefined> {
        try {
            const data = await this.api.getLatestCompatibleExtensionVersion(id);
            if (!data) {
                return;
            }
            if (data.error) {
                return this.onDidFailRefresh(id, data.error);
            }
            const extension = this.setExtension(id);
            extension.update(Object.assign(data, {
                publisher: data.namespace,
                downloadUrl: data.files.download,
                iconUrl: data.files.icon,
                readmeUrl: data.files.readme,
                licenseUrl: data.files.license,
                version: data.version
            }));
            return extension;
        } catch (e) {
            return this.onDidFailRefresh(id, e);
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected onDidFailRefresh(id: string, error: any): VSXExtension | undefined {
        const cached = this.getExtension(id);
        if (cached && cached.installed) {
            return cached;
        }
        console.error(`[${id}]: failed to refresh, reason:`, error);
        return undefined;
    }

    /**
     * Compare two extensions based on their display name, and publisher if applicable.
     * @param a the first extension id for comparison.
     * @param b the second extension id for comparison.
     */
    protected compareExtensions(a: string, b: string): number {
        const extensionA = this.getExtension(a);
        const extensionB = this.getExtension(b);
        if (!extensionA || !extensionB) {
            return 0;
        }
        if (extensionA.displayName && extensionB.displayName) {
            return extensionA.displayName.localeCompare(extensionB.displayName);
        }
        if (extensionA.publisher && extensionB.publisher) {
            return extensionA.publisher.localeCompare(extensionB.publisher);
        }
        return 0;
    }

    protected getPrefix(query: string): string {
        return query.split(' ')[0];
    }

    protected isPrefixQuery(query: string): boolean {
        return query.startsWith('@');
    }

    protected isInstalledPrefix(prefix: string): boolean {
        return /@installed/i.test(prefix);
    }

    protected isBuiltInPrefix(prefix: string): boolean {
        return /@builtin/i.test(prefix);
    }

}
