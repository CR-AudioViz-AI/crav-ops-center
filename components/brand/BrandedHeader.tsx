// components/brand/BrandedHeader.tsx
//
// 2026-08-30: RE-EXPORT. The component lives in @craudioviz/platform-sdk.
//
// Fifty-nine local copies existed across the org in eleven distinct versions, and the
// forks were WRONG rather than merely stale: the plan union omitted 'creator' and
// 'enterprise' while User.subscription_tier carries both, so a PAYING creator or
// enterprise customer was shown 'free' in the header.
export { BrandedHeader } from '@craudioviz/platform-sdk';
export { BrandedHeader as default } from '@craudioviz/platform-sdk';
