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

import { injectable, inject } from 'inversify';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { VSXExtensionsViewContainer } from './vsx-extensions-view-container';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { VSXExtensionsModel } from './vsx-extensions-model';
import { ColorContribution } from '@theia/core/lib/browser/color-application-contribution';
import { ColorRegistry, Color } from '@theia/core/lib/browser/color-registry';
import { TabBarToolbarContribution, TabBarToolbarItem, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { MessageService, Mutable } from '@theia/core/lib/common';
import { FileDialogService, OpenFileDialogProps } from '@theia/filesystem/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { PluginServer } from '@theia/plugin-ext/lib/common';
import URI from '@theia/core/lib/common/uri';
import { LabelProvider } from '@theia/core/lib/browser';

export namespace VSXExtensionsCommands {
    export const CLEAR_ALL: Command = {
        id: 'vsxExtensions.clearAll',
        category: 'Extensions',
        label: 'Clear Search Results',
        iconClass: 'clear-all'
    };
    export const HELLO_WORLD: Command = {
        id: 'vsxExtensions.helloWorld',
        category: 'Extensions',
        label: 'Hello World'
    };
    export const INSTALL_FROM_VSIX: Command & { dialogLabel: string } = {
        id: 'vsxExtensions.installFromVSIX',
        category: 'Extensions',
        label: 'Install from VSIX...',
        dialogLabel: 'Install from VSIX'
    };
}

@injectable()
export class VSXExtensionsContribution extends AbstractViewContribution<VSXExtensionsViewContainer>
    implements ColorContribution, FrontendApplicationContribution, TabBarToolbarContribution {

    @inject(VSXExtensionsModel) protected readonly model: VSXExtensionsModel;
    @inject(CommandRegistry) protected readonly commandRegistry: CommandRegistry;
    @inject(PluginServer) protected readonly pluginServer: PluginServer;
    @inject(TabBarToolbarRegistry) protected readonly tabbarToolbarRegistry: TabBarToolbarRegistry;
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService;
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService;
    @inject(MessageService) protected readonly messageService: MessageService;
    @inject(LabelProvider) protected readonly labelProvider: LabelProvider;

    constructor() {
        super({
            widgetId: VSXExtensionsViewContainer.ID,
            widgetName: VSXExtensionsViewContainer.LABEL,
            defaultWidgetOptions: {
                area: 'left',
                rank: 500
            },
            toggleCommandId: 'vsxExtensions.toggle',
            toggleKeybinding: 'ctrlcmd+shift+x'
        });
    }

    async initializeLayout(app: FrontendApplication): Promise<void> {
        await this.openView({ activate: false });
    }

    registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(VSXExtensionsCommands.CLEAR_ALL, {
            execute: w => this.withWidget(w, () => this.model.search.query = ''),
            isEnabled: w => this.withWidget(w, () => !!this.model.search.query),
            isVisible: w => this.withWidget(w, () => true)
        });

        commands.registerCommand(VSXExtensionsCommands.HELLO_WORLD, {
            execute: () => this.messageService.info('Hello World'),
        });

        commands.registerCommand(VSXExtensionsCommands.INSTALL_FROM_VSIX, {
            isEnabled: () => true,
            execute: () => this.installFromVSIX()
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: VSXExtensionsCommands.CLEAR_ALL.id,
            command: VSXExtensionsCommands.CLEAR_ALL.id,
            tooltip: VSXExtensionsCommands.CLEAR_ALL.label,
            priority: 1,
            onDidChange: this.model.onDidChange
        });

        this.registerMoreToolbarItem({
            id: VSXExtensionsCommands.HELLO_WORLD.id,
            command: VSXExtensionsCommands.HELLO_WORLD.id,
            tooltip: VSXExtensionsCommands.HELLO_WORLD.label,
            group: 'other_1'
        });

        this.registerMoreToolbarItem({
            id: VSXExtensionsCommands.INSTALL_FROM_VSIX.id,
            command: VSXExtensionsCommands.INSTALL_FROM_VSIX.id,
            tooltip: VSXExtensionsCommands.INSTALL_FROM_VSIX.label,
            group: 'other_2'
        });
    }

    /**
     * Register commands to the `More Actions...` extensions toolbar item.
     */
    public registerMoreToolbarItem = (item: Mutable<TabBarToolbarItem>) => {
        const commandId = item.command;
        const id = 'vsxExtensions.tabbar.toolbar.' + commandId;
        const command = this.commandRegistry.getCommand(commandId);
        this.commandRegistry.registerCommand({ id, iconClass: command && command.iconClass }, {
            execute: (w, ...args) => w instanceof VSXExtensionsViewContainer
                && this.commandRegistry.executeCommand(commandId, ...args),
            isEnabled: (w, ...args) => w instanceof VSXExtensionsViewContainer
                && this.commandRegistry.isEnabled(commandId, ...args),
            isVisible: (w, ...args) => w instanceof VSXExtensionsViewContainer
                && this.commandRegistry.isVisible(commandId, ...args),
            isToggled: (w, ...args) => w instanceof VSXExtensionsViewContainer
                && this.commandRegistry.isToggled(commandId, ...args),
        });
        item.command = id;
        this.tabbarToolbarRegistry.registerItem(item);
    };

    registerColors(colors: ColorRegistry): void {
        // VS Code colors should be aligned with https://code.visualstudio.com/api/references/theme-color#extensions
        colors.register(
            {
                id: 'extensionButton.prominentBackground', defaults: {
                    dark: '#327e36',
                    light: '#327e36'
                }, description: 'Button background color for actions extension that stand out (e.g. install button).'
            },
            {
                id: 'extensionButton.prominentForeground', defaults: {
                    dark: Color.white,
                    light: Color.white
                }, description: 'Button foreground color for actions extension that stand out (e.g. install button).'
            },
            {
                id: 'extensionButton.prominentHoverBackground', defaults: {
                    dark: '#28632b',
                    light: '#28632b'
                }, description: 'Button background hover color for actions extension that stand out (e.g. install button).'
            }
        );
    }

    protected withWidget<T>(widget: Widget | undefined = this.tryGetWidget(), fn: (widget: VSXExtensionsViewContainer) => T): T | false {
        if (widget instanceof VSXExtensionsViewContainer && widget.id === VSXExtensionsViewContainer.ID) {
            return fn(widget);
        }
        return false;
    }

    /**
     * Installs a local .vsix file after prompting the `Open File` dialog. Resolves to the URI of the file.
     */
    protected async installFromVSIX(): Promise<URI | undefined> {
        const props: OpenFileDialogProps = {
            title: VSXExtensionsCommands.INSTALL_FROM_VSIX.dialogLabel,
            openLabel: 'Install',
            filters: { 'VSIX Extensions (*.vsix)': ['vsix'] }
        };
        const [rootStat] = await this.workspaceService.roots;
        const destinationFileUri = await this.fileDialogService.showOpenDialog(props, rootStat);
        if (destinationFileUri) {
            if (destinationFileUri.path.toString().endsWith('.vsix')) {
                const pluginName = this.labelProvider.getName(destinationFileUri);
                try {
                    // await this.pluginServer.deploy(`local-file:${destinationFileUri.path}`);
                    this.commandRegistry.executeCommand('VscodeCommands.INSTALL_FROM_VSIX.id', destinationFileUri);
                    this.messageService.info(`Completed installing ${pluginName} from VSIX.`);
                } catch {
                    this.messageService.error(`Failed to install ${pluginName} from VSIX.`);
                }
            } else {
                this.messageService.error('The selected file is not a valid "*.vsix" plugin.');
            }
            return destinationFileUri;
        }
        return undefined;
    }
}
