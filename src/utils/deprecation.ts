import { DeprecationInfo } from '../models/DeprecationInfo';

export function formatDeprecationMessage(info: DeprecationInfo | undefined): string | undefined {
    if (!info) {
        return undefined;
    }
    const parts: string[] = [];
    if (info.reasons && info.reasons.length > 0) {
        parts.push(info.reasons.join(', '));
    }
    if (info.message) {
        parts.push(info.message);
    }
    if (info.alternatePackageId) {
        parts.push(`use ${info.alternatePackageId}${info.alternatePackageRange ? ' ' + info.alternatePackageRange : ''} instead`);
    }
    return parts.length > 0 ? parts.join(' — ') : 'This package is deprecated.';
}
