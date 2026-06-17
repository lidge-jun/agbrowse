// @ts-check

/**
 * @typedef {{x:number,y:number,width:number,height:number}} Box
 * @typedef {{ref:string, role:string, name:string, box?:Box}} BundleRef
 * @typedef {{refs:BundleRef[]}} ObservationBundle
 * @typedef {{point:{x:number,y:number}, bbox?:Box|null, confidence?:number}} VisionCandidate
 */

/**
 * @param {{candidate: VisionCandidate, bundle: ObservationBundle, maxDistance?: number}} input
 */
export function reconcileVisionCandidate(input) {
    const maxDistance = input.maxDistance ?? 32;
    const refs = Array.isArray(input.bundle?.refs) ? input.bundle.refs.filter((r) => r.box) : [];
    const point = input.candidate.point;
    const containing = refs.filter((r) => contains(r.box, point));
    if (containing.length === 1) {
        return { action: 'ref', ref: containing[0].ref, reason: 'candidate_center_inside_ref_box' };
    }
    if (containing.length > 1) {
        return { action: 'fail', code: 'COMPUTER_TARGET_AMBIGUOUS', reason: 'multiple_ref_boxes_contain_candidate' };
    }
    const nearby = refs
        .map((r) => ({ ref: r.ref, distance: distanceToBoxCenter(point, r.box) }))
        .filter((r) => r.distance <= maxDistance)
        .sort((a, b) => a.distance - b.distance);
    if (nearby.length === 1 || (nearby.length > 1 && nearby[0].distance + 8 < nearby[1].distance)) {
        return { action: 'ref', ref: nearby[0].ref, reason: 'candidate_center_near_ref_box' };
    }
    if (nearby.length > 1) {
        return { action: 'fail', code: 'COMPUTER_TARGET_AMBIGUOUS', reason: 'multiple_nearby_ref_boxes' };
    }
    return { action: 'coordinate', reason: 'no_matching_ref_box' };
}

/**
 * @param {{basis?:{url?:string,targetId?:string}, url?:string, targetId?:string}} bundle
 * @param {{url?:string,targetId?:string}} current
 */
export function assertFreshObservationBundle(bundle, current) {
    const basis = bundle.basis || bundle;
    if (basis.url && current.url && basis.url !== current.url) {
        throw new Error('COMPUTER_OBSERVATION_STALE: observation URL does not match current page');
    }
    if (basis.targetId && current.targetId && basis.targetId !== current.targetId) {
        throw new Error('COMPUTER_OBSERVATION_STALE: observation targetId does not match current page');
    }
}

/**
 * @param {Box|undefined} box
 * @param {{x:number,y:number}} point
 */
function contains(box, point) {
    if (!box) return false;
    return (
        point.x >= box.x &&
        point.y >= box.y &&
        point.x <= box.x + box.width &&
        point.y <= box.y + box.height
    );
}

/**
 * @param {{x:number,y:number}} point
 * @param {Box|undefined} box
 */
function distanceToBoxCenter(point, box) {
    if (!box) return Number.POSITIVE_INFINITY;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    return Math.hypot(point.x - cx, point.y - cy);
}
