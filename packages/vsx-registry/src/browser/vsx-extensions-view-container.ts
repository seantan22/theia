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
 *******************************************************************************‚*/

import { injectable, inject, postConstruct } from 'inversify';
import { ViewContainer, PanelLayout, ViewContainerPart, Message } from '@theia/core/lib/browser';
import { VSXExtensionsSearchBar } from './vsx-extensions-search-bar';
import { VSXExtensionsWidget } from './vsx-extensions-widget';
import { VSXExtensionsModel } from './vsx-extensions-model';
import { VSXExtensionsSearchModel } from './vsx-extensions-search-model';

@injectable()
export class VSXExtensionsViewContainer extends ViewContainer {

    static ID = 'vsx-extensions-view-container';
    static LABEL = 'Extensions';

    static NO_RESULTS_ID = 'view-container-no-results';

    @inject(VSXExtensionsSearchBar)
    protected readonly searchBar: VSXExtensionsSearchBar;

    @inject(VSXExtensionsModel)
    protected readonly model: VSXExtensionsModel;

    @inject(VSXExtensionsSearchModel)
    readonly search: VSXExtensionsSearchModel;

    @postConstruct()
    protected async init(): Promise<void> {
        super.init();
        this.id = VSXExtensionsViewContainer.ID;
        this.addClass('theia-vsx-extensions-view-container');

        this.setTitleOptions({
            label: VSXExtensionsViewContainer.LABEL,
            iconClass: 'theia-vsx-extensions-icon',
            closeable: true
        });

        this.toDispose.push(this.searchBar.onDidPrefixQuery(async prefix => {
            if (prefix === 'builtin') {
                this.showPart(VSXExtensionsWidget.BUILT_IN_ID);
            } else if (prefix === 'installed') {
                this.showPart(VSXExtensionsWidget.INSTALLED_ID);
            }
        }));

        this.toDispose.push(this.model.onDidResults(async resultsCount => {
            // Get the view extensions part to the display the message in.
            const part = this.currentPart;
            if (!part) {
                return;
            }

            // Create an element that displays a message for no results.
            const noResultsMsg = document.createElement('div');
            noResultsMsg.id = VSXExtensionsViewContainer.NO_RESULTS_ID;
            noResultsMsg.className = 'theia-vsx-extensions-no-results';
            noResultsMsg.innerHTML = 'No extensions found.';

            // Show or hide the message depending on number of results.
            const msg = document.getElementById(VSXExtensionsViewContainer.NO_RESULTS_ID);
            if (resultsCount === 0) {
                if (!msg) {
                    part.node.parentNode?.appendChild(noResultsMsg);
                } else {
                    msg.classList.remove('hide');
                }
            } else if (msg && resultsCount > 0) {
                msg.classList.add('hide');
            }
        }));
    }

    protected onActivateRequest(msg: Message): void {
        this.searchBar.activate();
    }

    protected onAfterAttach(msg: Message): void {
        super.onBeforeAttach(msg);
        this.updateMode();
        this.toDisposeOnDetach.push(this.model.search.onDidChangeQuery(() => this.updateMode()));
    }

    protected configureLayout(layout: PanelLayout): void {
        layout.addWidget(this.searchBar);
        super.configureLayout(layout);
    }

    protected registerPart(part: ViewContainerPart): void {
        super.registerPart(part);
        this.applyModeToPart(part);
    }

    protected currentMode: VSXExtensionsViewContainer.Mode = VSXExtensionsViewContainer.InitialMode;
    protected readonly lastModeState = new Map<VSXExtensionsViewContainer.Mode, ViewContainer.State>();

    protected updateMode(): void {
        const currentMode = this.getCurrentMode();
        if (currentMode === this.currentMode) {
            return;
        }
        if (this.currentMode !== VSXExtensionsViewContainer.InitialMode) {
            this.lastModeState.set(this.currentMode, super.doStoreState());
        }
        this.currentMode = currentMode;
        const lastState = this.lastModeState.get(currentMode);
        if (lastState) {
            super.doRestoreState(lastState);
        }
        this.getParts().find(part => this.applyModeToPart(part));
    }

    /**
     * Returns the current view container mode.
     */
    protected getCurrentMode(): VSXExtensionsViewContainer.Mode {
        let currentMode: VSXExtensionsViewContainer.Mode;
        if (!this.model.search.query) {
            currentMode = VSXExtensionsViewContainer.DefaultMode;
            const noResultsMsg = document.getElementById(VSXExtensionsViewContainer.NO_RESULTS_ID);
            noResultsMsg?.classList.add('hide');
        } else if (this.search.query.startsWith('@installed')) {
            currentMode = VSXExtensionsViewContainer.InstalledMode;
        } else if (this.search.query.startsWith('@builtin')) {
            currentMode = VSXExtensionsViewContainer.BuiltinMode;
        } else {
            currentMode = VSXExtensionsViewContainer.SearchResultMode;
        }
        return currentMode;
    }

    /**
     * Displays a specific widget and hides all other widgets.
     *
     * @param widgetId an extensions view widget.
     */
    protected showPart(widgetId: string): void {
        this.getParts().find(part => {
            if (part.wrapped.id === widgetId) {
                this.currentPart = part;
                part.collapsed = false;
                part.show();
            } else {
                part.hide();
            }
        });
    }

    /**
     * Displays the part(s) associated with a particular mode.
     *
     * @param part the view container part.
     */
    protected applyModeToPart(part: ViewContainerPart): void {
        const partMode = this.getCorrespondingMode(part);
        if (this.currentMode !== VSXExtensionsViewContainer.DefaultMode) {
            // Display the widget corresponding to the current mode.
            if (this.currentMode === partMode) {
                this.currentPart = part;
                part.collapsed = false;
                part.show();
            } else {
                part.hide();
            }
        } else {
            // In Default Mode, show `Installed` and `Builtin` widgets.
            if (part.wrapped.id === VSXExtensionsWidget.INSTALLED_ID || part.wrapped.id === VSXExtensionsWidget.BUILT_IN_ID) {
                part.show();
            } else {
                part.hide();
            }
        }
    }

    /**
     * Returns the view container mode that corresponds to the given part.
     *
     * @param part the view container part.
     */
    protected getCorrespondingMode(part: ViewContainerPart): VSXExtensionsViewContainer.Mode {
        let mode: VSXExtensionsViewContainer.Mode;
        switch (part.wrapped.id) {
            case VSXExtensionsWidget.SEARCH_RESULT_ID:
                mode = VSXExtensionsViewContainer.SearchResultMode;
                break;
            case VSXExtensionsWidget.INSTALLED_ID:
                mode = VSXExtensionsViewContainer.InstalledMode;
                break;
            case VSXExtensionsWidget.BUILT_IN_ID:
                mode = VSXExtensionsViewContainer.BuiltinMode;
                break;
            default:
                mode = VSXExtensionsViewContainer.DefaultMode;
        }
        return mode;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected doStoreState(): any {
        const modes: VSXExtensionsViewContainer.State['modes'] = {};
        for (const mode of this.lastModeState.keys()) {
            modes[mode] = this.lastModeState.get(mode);
        }
        return {
            query: this.model.search.query,
            modes
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected doRestoreState(state: any): void {
        // eslint-disable-next-line guard-for-in
        for (const key in state.modes) {
            const mode = Number(key) as VSXExtensionsViewContainer.Mode;
            const modeState = state.modes[mode];
            if (modeState) {
                this.lastModeState.set(mode, modeState);
            }
        }
        this.model.search.query = state.query;
    }

}
export namespace VSXExtensionsViewContainer {
    export const InitialMode = 0;
    export const DefaultMode = 1;
    export const SearchResultMode = 2;
    export const InstalledMode = 3;
    export const BuiltinMode = 4;
    export type Mode = typeof InitialMode | typeof DefaultMode | typeof SearchResultMode | typeof InstalledMode | typeof BuiltinMode;
    export interface State {
        query: string;
        modes: {
            [mode: number]: ViewContainer.State | undefined
        }
    }
}
