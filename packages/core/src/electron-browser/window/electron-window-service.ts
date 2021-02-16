/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
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

import * as electron from 'electron';
import { injectable, inject } from 'inversify';
import { remote } from 'electron';
import { NewWindowOptions } from '../../browser/window/window-service';
import { DefaultWindowService } from '../../browser/window/default-window-service';
import { ElectronMainWindowService } from '../../electron-common/electron-main-window-service';
import { WindowConfiguration, WindowPreferences } from './window-preferences';
import { PreferenceChangeEvent } from '../../browser';

@injectable()
export class ElectronWindowService extends DefaultWindowService {

    /**
     * Lock to prevent multiple parallel executions of the `beforeunload` listener.
     */
    protected isUnloading: boolean = false;

    /**
     * Close the window right away when `true`, else check if we can unload.
     */
    protected closeOnUnload: boolean = false;

    /**
     * Do not update window zoom level if preference is unchanged.
     */
    protected prevPreferredZoomLevel: number | undefined;

    @inject(ElectronMainWindowService)
    protected readonly delegate: ElectronMainWindowService;

    @inject(WindowPreferences)
    protected readonly windowPreferences: WindowPreferences;

    openNewWindow(url: string, { external }: NewWindowOptions = {}): undefined {
        this.delegate.openNewWindow(url, { external });
        return undefined;
    }

    registerUnloadListeners(): void {
        window.addEventListener('beforeunload', event => {
            if (this.isUnloading) {
                // Unloading process ongoing, do nothing:
                return this.preventUnload(event);
            } else if (this.closeOnUnload || this.canUnload()) {
                // Let the window close and notify clients:
                delete event.returnValue;
                this.onUnloadEmitter.fire();
                return;
            } else {
                this.isUnloading = true;
                // Fix https://github.com/eclipse-theia/theia/issues/8186#issuecomment-742624480
                // On Electron/Linux doing `showMessageBoxSync` does not seems to block the closing
                // process long enough and closes the window no matter what you click on (yes/no).
                // Instead we'll prevent closing right away, ask for confirmation and finally close.
                setTimeout(() => {
                    if (this.shouldUnload()) {
                        this.closeOnUnload = true;
                        window.close();
                    }
                    this.isUnloading = false;
                });
                return this.preventUnload(event);
            }
        });

        // Update changes to zoom level.
        this.updateWindowZoomLevel();
        this.windowPreferences.onPreferenceChanged((e: PreferenceChangeEvent<WindowConfiguration>) => {
            if (e.affects('window.zoomLevel')) {
                this.updateWindowZoomLevel();
            }
        });
    }

    /**
     * When preventing `beforeunload` on Electron, no popup is shown.
     *
     * This method implements a modal to ask the user if he wants to quit the page.
     */
    protected shouldUnload(): boolean {
        const electronWindow = remote.getCurrentWindow();
        const response = remote.dialog.showMessageBoxSync(electronWindow, {
            type: 'question',
            buttons: ['Yes', 'No'],
            title: 'Confirm',
            message: 'Are you sure you want to quit?',
            detail: 'Any unsaved changes will not be saved.'
        });
        return response === 0; // 'Yes', close the window.
    }

    /**
     * Updates the window zoom level based on the amount set in `Preferences`.
     */
    protected updateWindowZoomLevel(): void {
        const preferredZoomLevel = this.windowPreferences['window.zoomLevel'];
        if (this.prevPreferredZoomLevel === preferredZoomLevel) {
            return;
        }
        this.prevPreferredZoomLevel = preferredZoomLevel;

        const currentWindow = electron.remote.getCurrentWindow();
        const webContents = currentWindow.webContents;

        if (webContents.getZoomLevel() !== preferredZoomLevel) {
            webContents.setZoomLevel(preferredZoomLevel);
        }
    }
}
