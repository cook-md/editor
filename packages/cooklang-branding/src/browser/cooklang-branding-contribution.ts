// *****************************************************************************
// Copyright (C) 2024 cook.md
//
// SPDX-License-Identifier: MIT
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { Theme } from '@theia/core/lib/common/theme';
import { MonacoThemeRegistry } from '@theia/monaco/lib/browser/textmate/monaco-theme-registry';

const THEME_LABEL_MAP: Record<string, string> = {
    'dark': 'Dark (Cooklang)',
    'light': 'Light (Cooklang)',
    'hc-theia': 'High Contrast (Cooklang)',
    'hc-theia-light': 'High Contrast Light (Cooklang)',
};

interface BrandColors {
    [key: string]: string;
}

const DARK_BRAND_COLORS: BrandColors = {
    'activityBar.background': '#0a0a0f',
    'activityBar.foreground': '#D4D4D4',
    'activityBar.activeBorder': '#e15a29',
    'activityBar.activeBackground': '#e15a2915',
    'activityBarBadge.background': '#e15a29',
    'activityBarBadge.foreground': '#ffffff',
    'focusBorder': '#e15a2980',
    'sideBar.background': '#0f0f15',
    'sideBarTitle.foreground': '#BBBBBB',
    'sideBarSectionHeader.background': '#0000',
    'sideBarSectionHeader.border': '#ffffff14',
    'list.activeSelectionBackground': '#e15a2930',
    'list.activeSelectionForeground': '#ffffff',
    'list.hoverBackground': '#e15a2915',
    'list.focusOutline': '#e15a29',
    'statusBar.background': '#e15a29',
    'statusBar.foreground': '#ffffff',
    'statusBar.noFolderBackground': '#d14e20',
    'statusBar.debuggingBackground': '#d14e20',
    'statusBarItem.remoteForeground': '#ffffff',
    'statusBarItem.remoteBackground': '#d14e20',
    'titleBar.activeBackground': '#0a0a0f',
    'titleBar.activeForeground': '#D4D4D4',
    'titleBar.inactiveBackground': '#0a0a0f',
    'titleBar.inactiveForeground': '#999999',
    'tab.selectedBackground': '#141419',
    'tab.selectedForeground': '#ffffffa0',
    'tab.lastPinnedBorder': '#ffffff14',
    'progressBar.background': '#e15a29',
    'textLink.foreground': '#e15a29',
    'textLink.activeForeground': '#f07050',
    'button.background': '#e15a29',
    'button.foreground': '#ffffff',
    'button.hoverBackground': '#d14e20',
    'badge.background': '#e15a29',
    'badge.foreground': '#ffffff',
    'editor.background': '#141419',
    'editor.foreground': '#D4D4D4',
    'editorWidget.border': '#ffffff14',
    'widget.border': '#ffffff14',
    'input.border': '#ffffff14',
    'input.placeholderForeground': '#A6A6A6',
    'dropdown.border': '#ffffff14',
    'checkbox.border': '#6B6B6B',
    'menu.background': '#0f0f15',
    'menu.foreground': '#CCCCCC',
    'menu.separatorBackground': '#ffffff14',
    'menu.border': '#ffffff14',
    'menu.selectionBackground': '#e15a2930',
    'notificationLink.foreground': '#e15a29',
    'pickerGroup.foreground': '#e15a29',
    'editorLineNumber.activeForeground': '#e15a29',
    'editorCursor.foreground': '#e15a29',
    'selection.background': '#e15a2940',
    'minimap.selectionHighlight': '#e15a2960',
};

const LIGHT_BRAND_COLORS: BrandColors = {
    'activityBar.background': '#faf5f3',
    'activityBar.foreground': '#16161d',
    'activityBar.activeBorder': '#e15a29',
    'activityBar.activeBackground': '#e15a290d',
    'activityBarBadge.background': '#e15a29',
    'activityBarBadge.foreground': '#ffffff',
    'focusBorder': '#e15a2980',
    'sideBar.background': '#f8f4f2',
    'sideBarTitle.foreground': '#16161d',
    'sideBarSectionHeader.background': '#0000',
    'sideBarSectionHeader.border': '#16161d14',
    'list.activeSelectionBackground': '#e15a2918',
    'list.activeSelectionForeground': '#16161d',
    'list.hoverBackground': '#e15a290d',
    'list.focusOutline': '#e15a29',
    'statusBar.background': '#e15a29',
    'statusBar.foreground': '#ffffff',
    'statusBar.noFolderBackground': '#d14e20',
    'statusBar.debuggingBackground': '#d14e20',
    'statusBarItem.remoteForeground': '#ffffff',
    'statusBarItem.remoteBackground': '#d14e20',
    'titleBar.activeBackground': '#faf5f3',
    'titleBar.activeForeground': '#16161d',
    'titleBar.inactiveBackground': '#faf5f3',
    'titleBar.inactiveForeground': '#998178',
    'tab.selectedBackground': '#ffffff',
    'tab.selectedForeground': '#16161db3',
    'tab.lastPinnedBorder': '#16161d14',
    'progressBar.background': '#e15a29',
    'textLink.foreground': '#e15a29',
    'textLink.activeForeground': '#d14e20',
    'button.background': '#e15a29',
    'button.foreground': '#ffffff',
    'button.hoverBackground': '#d14e20',
    'badge.background': '#e15a29',
    'badge.foreground': '#ffffff',
    'editor.background': '#ffffff',
    'editor.foreground': '#16161d',
    'editorWidget.border': '#16161d14',
    'widget.border': '#16161d14',
    'input.border': '#16161d14',
    'dropdown.border': '#16161d14',
    'checkbox.border': '#16161d30',
    'menu.border': '#16161d14',
    'menu.selectionBackground': '#e15a2918',
    'notificationLink.foreground': '#e15a29',
    'pickerGroup.foreground': '#e15a29',
    'editorLineNumber.activeForeground': '#e15a29',
    'editorCursor.foreground': '#e15a29',
    'selection.background': '#e15a2930',
    'minimap.selectionHighlight': '#e15a2960',
};

const HC_DARK_BRAND_COLORS: BrandColors = {
    'activityBarBadge.background': '#e15a29',
    'activityBarBadge.foreground': '#ffffff',
    'focusBorder': '#e15a29',
    'statusBar.background': '#e15a29',
    'statusBar.foreground': '#ffffff',
    'progressBar.background': '#e15a29',
    'textLink.foreground': '#f07050',
    'button.background': '#e15a29',
    'button.foreground': '#ffffff',
    'button.hoverBackground': '#d14e20',
    'badge.background': '#e15a29',
    'badge.foreground': '#ffffff',
    'notificationLink.foreground': '#f07050',
    'editorCursor.foreground': '#e15a29',
};

const HC_LIGHT_BRAND_COLORS: BrandColors = {
    'activityBarBadge.background': '#e15a29',
    'activityBarBadge.foreground': '#ffffff',
    'focusBorder': '#e15a29',
    'statusBar.background': '#e15a29',
    'statusBar.foreground': '#ffffff',
    'progressBar.background': '#e15a29',
    'textLink.foreground': '#d14e20',
    'button.background': '#e15a29',
    'button.foreground': '#ffffff',
    'button.hoverBackground': '#d14e20',
    'badge.background': '#e15a29',
    'badge.foreground': '#ffffff',
    'notificationLink.foreground': '#d14e20',
    'editorCursor.foreground': '#e15a29',
};

const THEME_COLORS: Record<string, BrandColors> = {
    'dark-theia': DARK_BRAND_COLORS,
    'light-theia': LIGHT_BRAND_COLORS,
    'hc-theia': HC_DARK_BRAND_COLORS,
    'hc-theia-light': HC_LIGHT_BRAND_COLORS,
};

@injectable()
export class CooklangBrandingContribution implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    @inject(MonacoThemeRegistry)
    protected readonly monacoThemeRegistry: MonacoThemeRegistry;

    initialize(): void {
        this.applyThemeLabels();
        this.applyThemeColors();
    }

    protected applyThemeLabels(): void {
        const themes: Theme[] = [];
        for (const theme of this.themeService.getThemes()) {
            const label = THEME_LABEL_MAP[theme.id];
            if (label) {
                themes.push({ ...theme, label });
            }
        }
        if (themes.length > 0) {
            this.themeService.register(...themes);
        }
    }

    protected applyThemeColors(): void {
        for (const [editorTheme, brandColors] of Object.entries(THEME_COLORS)) {
            const existing = this.monacoThemeRegistry.getThemeData(editorTheme);
            if (existing) {
                const patched = {
                    ...existing,
                    colors: { ...existing.colors, ...brandColors },
                };
                this.monacoThemeRegistry.setTheme(editorTheme, patched);
            }
        }
    }
}
