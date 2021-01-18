/********************************************************************************
 * Copyright (C) 2020 TORO Limited and others.
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

import { inject, injectable, interfaces } from 'inversify';
import { AbstractViewContribution, bindViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { Command, CommandRegistry, Emitter, MessageService } from '@theia/core/lib/common';
import { Widget, WidgetFactory } from '@theia/core/lib/browser';
import { SampleViewUnclosableView } from './sample-unclosable-view';

export const SampleToolBarCommand: Command = {
    id: 'navigator.toggle.sampleToolbarCommand',
    category: 'Sample',
    label: 'Sample Toolbar Command',
    iconClass: 'theia-add-icon'
};

@injectable()
export class SampleUnclosableViewContribution extends AbstractViewContribution<SampleViewUnclosableView> implements TabBarToolbarContribution {

    static readonly SAMPLE_UNCLOSABLE_VIEW_TOGGLE_COMMAND_ID = 'sampleUnclosableView:toggle';

    protected toolbarItemState = false;
    protected readonly onSampleToolbarStateChangedEmitter = new Emitter<void>();

    @inject(MessageService) protected readonly messageService: MessageService;

    constructor() {
        super({
            widgetId: SampleViewUnclosableView.ID,
            widgetName: 'Sample Unclosable View',
            toggleCommandId: SampleUnclosableViewContribution.SAMPLE_UNCLOSABLE_VIEW_TOGGLE_COMMAND_ID,
            defaultWidgetOptions: {
                area: 'main'
            }
        });
    }

    protected withWidget<T>(widget: Widget | undefined = this.tryGetWidget(), cb: (sampleView: SampleViewUnclosableView) => T): T | false {
        if (widget instanceof SampleViewUnclosableView && widget.id === SampleViewUnclosableView.ID) {
            return cb(widget);
        }
        return false;
    }

    registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(SampleToolBarCommand, {
            execute: () => {
                this.updateToolbarItemState();
                this.messageService.info(`${SampleToolBarCommand.label} is toggled = ${this.toolbarItemState}`);
            },
            isEnabled: widget => this.withWidget(widget, () => true),
            isVisible: widget => this.withWidget(widget, () => true),
            isToggled: () => this.toolbarItemState
        });
    }

    async registerToolbarItems(toolbarRegistry: TabBarToolbarRegistry): Promise<void> {
        toolbarRegistry.registerItem({
            id: SampleToolBarCommand.id,
            command: SampleToolBarCommand.id,
            tooltip: 'Click to Toggle Toolbar Item',
            priority: 0,
            onDidChange: this.onSampleToolbarStateChangedEmitter.event
        });
    }

    protected updateToolbarItemState(): void {
        this.toolbarItemState = !this.toolbarItemState;
        this.onSampleToolbarStateChangedEmitter.fire();
    }
}

export const bindSampleUnclosableView = (bind: interfaces.Bind) => {
    bindViewContribution(bind, SampleUnclosableViewContribution);
    bind(TabBarToolbarContribution).to(SampleUnclosableViewContribution).inSingletonScope();
    bind(SampleViewUnclosableView).toSelf();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: SampleViewUnclosableView.ID,
        createWidget: () => ctx.container.get<SampleViewUnclosableView>(SampleViewUnclosableView)
    }));
};
