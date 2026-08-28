/**
 * CR AudioViz AI Brand System
 * 
 * Export all brand components and configurations.
 * Usage: import { BrandedHeader, ThemeProvider } from '@/components/brand';
 */

// 2026-08-27: removed the export of './tailwind.brand.config' — that file is
// not in this package. TS2307 on every consumer of this barrel.
//
// Same defect fixed in platform-sdk today. It is here because the shell was
// FORKED into 53 repos; one fix upstream does not reach a copy.
//
// Configuration
export { default as brandConfig, BRAND_COLORS, THEME_CONFIG, TYPOGRAPHY, SPACING, LOGO_SPECS, CREDITS_CONFIG, APP_LOGO_STATUS } from './brand-config';

// Theme
export { ThemeProvider, useTheme } from './ThemeProvider';
export { ThemeToggle } from './ThemeToggle';

// Components
export { BrandedHeader } from './BrandedHeader';
export { BrandedFooter } from './BrandedFooter';
export { CreditsBar } from './CreditsBar';
export { AuthButtons } from './AuthButtons';

// Tailwind config extension
