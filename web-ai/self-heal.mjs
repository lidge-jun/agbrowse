import { observeProviderTargets, rankTargetCandidates } from './observe-targets.mjs';
import { semanticTargetsForVendor } from './vendor-editor-contract.mjs';
import { isRegistryStale, resolveRef } from './ref-registry.mjs';
import { WebAiError } from './errors.mjs';
import { CACHE_SCHEMA_VERSION, VALIDATION_REASONS, VALIDATION_THRESHOLD, RESOLUTION_SOURCES } from './constants.mjs';
import { createHash } from 'node:crypto';

// Preserve backward-compatible alias for existing consumers
export { RESOLUTION_SOURCES as ResolutionSource } from './constants.mjs';

const INTENT_FEATURE = Object.freeze({
    'composer.fill': 'composer',
    'composer.click': 'composer',
    'send.click': 'sendButton',
    'copy.lastResponse': 'copyButton',
    'modelPicker.open': 'modelPicker',
    'modelPicker.click': 'modelPicker',
    'upload.attach': 'uploadSurface',
    'upload.click': 'uploadSurface',
    'responseFeed.read': 'responseFeed',
    'streaming.check': 'streamingIndicator',
    'stop.click': 'streamingIndicator',
});

export function resolveIntentFeature(intent, featureOverride = null) {
    if (featureOverride) return featureOverride;
    return INTENT_FEATURE[intent] || null;
}

export async function resolveActionTarget(page, ctx) {
    const {
        provider,
        intent,
        actionKind = 'click',
        snapshot = null,
        registry = null,
        cache = null,
        fingerprint = null,
        feature: featureOverride = null,
        semanticTargetOverride = null,
        selectors: selectorsOverride = null,
    } = ctx;

    const feature = resolveIntentFeature(intent, featureOverride);
    const allTargets = semanticTargetsForVendor(provider);
    const semanticTarget = semanticTargetOverride || (feature ? allTargets[feature] : null);
    const selectors = selectorsOverride || semanticTarget?.cssFallbacks || [];
    const attempts = [];

    let urlHost = null;
    try { urlHost = new URL(page.url()).hostname; } catch { /* ignore */ }

    if (cache && typeof cache.get === 'function') {
        const cached = cache.get({ provider, intent, actionKind, urlHost, fingerprint });
        if (cached) {
            const validation = await validateResolvedTarget(page, cached.target, {
                semanticTarget,
                actionKind,
                registry,
                contractVersion: ctx.contractVersion,
                framePath: ctx.framePath,
                browserConfigHash: ctx.browserConfigHash,
            });
            attempts.push({ source: RESOLUTION_SOURCES.CACHE, validation });
            if (validation.ok) {
                return {
                    ok: true,
                    target: { ...cached.target, resolution: RESOLUTION_SOURCES.CACHE },
                    attempts,
                };
            }
        }
    }

    const candidates = await collectTargetCandidates(page, {
        provider,
        feature,
        semanticTarget,
        snapshot,
        registry,
        selectors,
    });

    const ranked = rankTargetCandidates(candidates, {
        expectedRole: semanticTarget?.roles?.[0] || null,
        expectedNames: semanticTarget?.names || [],
    });

    for (const candidate of ranked) {
        const validation = await validateResolvedTarget(page, candidate, {
            semanticTarget,
            actionKind,
            registry,
        });
        attempts.push({
            source: candidate.source,
            ref: candidate.ref || null,
            selector: candidate.selector || null,
            validation,
        });
        if (validation.ok) {
            return {
                ok: true,
                target: { ...candidate, resolution: candidate.source },
                attempts,
            };
        }
    }

    return {
        ok: false,
        errorCode: 'TARGET_UNRESOLVED',
        provider,
        intent,
        actionKind,
        feature,
        required: semanticTarget?.required || false,
        attempts,
    };
}

async function collectTargetCandidates(page, {
    provider,
    feature,
    semanticTarget,
    snapshot,
    registry,
    selectors = [],
}) {
    const candidates = [];

    if (snapshot?.refs && (!registry || !isRegistryStale(registry))) {
        const featureMap = semanticTargetsForVendor(provider);
        const observed = await observeProviderTargets(page, {
            provider,
            featureMap,
            snapshot,
        });
        if (feature && observed[feature]) {
            for (const c of observed[feature]) {
                candidates.push({ ...c, source: c.source || RESOLUTION_SOURCES.OBSERVE_RANKED });
            }
        }
    }

    for (const sel of selectors) {
        if (candidates.some(c => c.selector === sel)) continue;
        const count = await page.locator(sel).count().catch(() => 0);
        if (count > 0) {
            candidates.push({
                source: RESOLUTION_SOURCES.CSS_FALLBACK,
                selector: sel,
                count,
                confidence: count === 1 ? 3 : 1,
            });
        }
    }

    return candidates;
}

export async function validateResolvedTarget(page, target, {
    semanticTarget = null,
    actionKind = 'click',
    registry = null,
    contractVersion = null,
    framePath = null,
    browserConfigHash = null,
} = {}) {
    if (target?.schemaVersion && target.schemaVersion !== CACHE_SCHEMA_VERSION) {
        return { ok: false, reason: VALIDATION_REASONS.SCHEMA_VERSION_MISMATCH };
    }
    if (target?.contractVersion && contractVersion && target.contractVersion !== contractVersion) {
        return { ok: false, reason: VALIDATION_REASONS.CONTRACT_VERSION_MISMATCH };
    }
    if (target?.framePath && framePath && target.framePath !== framePath) {
        return { ok: false, reason: VALIDATION_REASONS.FRAME_PATH_MISMATCH };
    }
    if (target?.browserConfigHash && browserConfigHash && target.browserConfigHash !== browserConfigHash) {
        return { ok: false, reason: VALIDATION_REASONS.BROWSER_CONFIG_MISMATCH };
    }

    let selector = target?.selector;

    if (target?.ref && registry) {
        if (isRegistryStale(registry)) {
            return { ok: false, reason: VALIDATION_REASONS.REF_STALE };
        }
        try {
            const entry = await resolveRef(page, registry, target.ref, { allowStale: false });
            if (entry.selector) selector = entry.selector;
        } catch {
            return { ok: false, reason: VALIDATION_REASONS.REF_INVALID };
        }
    }

    if (!selector) {
        if (target?.ref && target.role && target.name) {
            const roleLocator = page.getByRole(target.role, { name: new RegExp(escapeForRegExp(target.name), 'i') });
            const roleCount = await roleLocator.count().catch(() => 0);
            if (roleCount === 0) return { ok: false, reason: VALIDATION_REASONS.NOT_FOUND };
            if (roleCount > 1) return { ok: false, reason: VALIDATION_REASONS.AMBIGUOUS_SELECTOR, count: roleCount };
            const roleEl = roleLocator.first();
            const roleVisible = await roleEl.isVisible().catch(() => false);
            if (!roleVisible) return { ok: false, reason: VALIDATION_REASONS.NOT_VISIBLE };
            const roleEnabled = await roleEl.isEnabled().catch(() => false);
            if (!roleEnabled) return { ok: false, reason: VALIDATION_REASONS.NOT_ENABLED };
            if (actionKind === 'fill') {
                const editable = await roleEl.isEditable().catch(() => false);
                if (!editable) return { ok: false, reason: VALIDATION_REASONS.NOT_EDITABLE };
            }
            return { ok: true, resolvedVia: 'role-locator', confidence: 1.0 };
        }
        if (target?.ref) return { ok: false, reason: VALIDATION_REASONS.REF_NO_SELECTOR };
        return { ok: false, reason: VALIDATION_REASONS.MISSING_SELECTOR };
    }

    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count === 0) return { ok: false, reason: VALIDATION_REASONS.NOT_FOUND };
    if (count > 1) return { ok: false, reason: VALIDATION_REASONS.AMBIGUOUS_SELECTOR, count };

    const el = locator.first();
    const visible = await el.isVisible().catch(() => false);
    if (!visible) return { ok: false, reason: VALIDATION_REASONS.NOT_VISIBLE };

    const enabled = await el.isEnabled().catch(() => false);
    if (!enabled) return { ok: false, reason: VALIDATION_REASONS.NOT_ENABLED };

    if (actionKind === 'fill') {
        const editable = await el.isEditable().catch(() => false);
        if (!editable) return { ok: false, reason: VALIDATION_REASONS.NOT_EDITABLE };
    }

    if (semanticTarget?.roles?.length || semanticTarget?.names?.length || target.role || target.name || target.nameHash) {
        const validation = await runValidationContract(page, el, {
            target,
            semanticTarget,
            actionKind,
        });
        if (!validation.ok) {
            return { ok: false, reason: validation.reason, confidence: validation.confidence };
        }
        return { ok: true, confidence: validation.confidence };
    }

    return { ok: true, confidence: 1.0 };
}

async function runValidationContract(page, locator, { target, semanticTarget, actionKind }) {
    try {
        const info = await locator.evaluate((node) => {
            const explicitRole = node.getAttribute('role');
            const tag = node.tagName.toLowerCase();
            const isEditable = node.isContentEditable || node.contentEditable === 'true';
            const implicitRole = explicitRole
                || (tag === 'textarea' ? 'textbox'
                    : (tag === 'input' && (!node.type || node.type === 'text') ? 'textbox'
                        : (isEditable ? 'textbox'
                            : (tag === 'button' ? 'button'
                                : (tag === 'a' && node.href ? 'link' : tag)))));
            const label = node.getAttribute('aria-label') || '';
            const labelledById = node.getAttribute('aria-labelledby') || '';
            let labelText = label;
            if (!labelText && labelledById) {
                const ref = node.ownerDocument?.getElementById(labelledById);
                labelText = ref?.textContent?.trim()?.slice(0, 100) || '';
            }
            if (!labelText) labelText = node.textContent?.trim()?.slice(0, 100) || '';
            return { role: implicitRole, label: labelText, tagName: tag, isEditable };
        }).catch(() => null);

        if (!info) return { ok: false, reason: 'eval-failed', confidence: 0 };

        let score = 0;
        let maxScore = 0;

        maxScore += 3;
        if (target.role) {
            if (target.role === info.role) score += 3;
            else if (semanticTarget?.roles?.includes(info.role)) score += 2;
        } else if (semanticTarget?.roles?.includes(info.role)) {
            score += 3;
        }

        maxScore += 3;
        if (target.nameHash) {
            const currentNameHash = info.label ? hashField(info.label) : null;
            if (currentNameHash === target.nameHash) score += 3;
        } else if (target.name) {
            const namePattern = new RegExp(escapeForRegExp(target.name), 'i');
            if (namePattern.test(info.label)) score += 3;
        } else if (semanticTarget?.names?.length) {
            if (semanticTarget.names.some(p => patternMatches(p, info.label))) {
                score += 3;
            }
        }

        maxScore += 2;
        if (semanticTarget?.excludeNames?.some(p => patternMatches(p, info.label))) {
            score -= 2;
        } else {
            score += 2;
        }

        maxScore += 2;
        if (actionKind === 'fill') {
            if (info.isEditable || info.tagName === 'textarea' || info.tagName === 'input') {
                score += 2;
            }
        } else if (actionKind === 'click') {
            if (info.tagName === 'button' || info.tagName === 'a' || info.role === 'button') {
                score += 2;
            }
        }

        const confidence = maxScore > 0 ? score / maxScore : 1;

        if (confidence < VALIDATION_THRESHOLD) {
            return { ok: false, reason: VALIDATION_REASONS.LOW_CONFIDENCE, confidence };
        }

        return { ok: true, confidence };
    } catch {
        return { ok: false, reason: 'contract-error', confidence: 0 };
    }
}

function patternMatches(pattern, value) {
    if (!pattern) return false;
    const text = String(value || '');
    if (pattern instanceof RegExp) {
        pattern.lastIndex = 0;
        return pattern.test(text);
    }
    return text.toLowerCase().includes(String(pattern).toLowerCase());
}

function hashField(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex').slice(0, 12)}`;
}

export async function locatorForResolvedTarget(page, target, { registry } = {}) {
    if (target.selector) {
        return page.locator(target.selector).first();
    }

    if (target.ref) {
        if (!registry) {
            throw new WebAiError({
                errorCode: 'internal.unhandled',
                stage: 'self-heal',
                retryHint: 'report',
                message: `ref ${target.ref} requires a registry to resolve`,
                evidence: { ref: target.ref },
            });
        }
        const resolved = await resolveRef(page, registry, target.ref, { allowStale: false });
        if (resolved.selector) return page.locator(resolved.selector).first();
        if (resolved.role && resolved.name) {
            return page.getByRole(resolved.role, { name: new RegExp(escapeForRegExp(resolved.name), 'i') }).first();
        }
        throw new WebAiError({
            errorCode: 'internal.unhandled',
            stage: 'self-heal',
            retryHint: 'report',
            message: `ref ${target.ref} resolved but not actionable`,
            evidence: { ref: target.ref, role: resolved.role },
        });
    }

    throw new WebAiError({
        errorCode: 'internal.unhandled',
        stage: 'self-heal',
        retryHint: 'report',
        message: 'target has neither selector nor ref',
        evidence: { target },
    });
}

function escapeForRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
