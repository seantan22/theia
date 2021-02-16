/********************************************************************************
 * Copyright (C) 2021 Ericsson and others.
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
import { interfaces } from 'inversify';
import { createPreferenceProxy, PreferenceContribution, PreferenceProxy, PreferenceSchema, PreferenceService } from '../../browser/preferences';

export const windowPreferencesSchema: PreferenceSchema = {
    type: 'object',
    properties: {
        'window.zoomLevel': {
            'type': 'number',
            'default': 0,
            'minimum': -8,
            'maximum': 9,
            'description': 'Adjust the zoom level of the window. The original size is 0. Each increment above (e.g. 1) or below (e.g. -1) represents zooming 20% larger or smaller.'
        },
    }
};

export class WindowConfiguration {
    'window.zoomLevel': number;
}

export const WindowPreferences = Symbol('WindowPreferences');
export type WindowPreferences = PreferenceProxy<WindowConfiguration>;

export function createWindowPreferences(preferences: PreferenceService): WindowPreferences {
    return createPreferenceProxy(preferences, windowPreferencesSchema);
}

export function bindWindowPreferences(bind: interfaces.Bind): void {
    bind(WindowPreferences).toDynamicValue(ctx => {
        const preferences = ctx.container.get<PreferenceService>(PreferenceService);
        return createWindowPreferences(preferences);
    }).inSingletonScope();

    bind(PreferenceContribution).toConstantValue({ schema: windowPreferencesSchema });
}
