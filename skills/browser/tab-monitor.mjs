// @ts-check
import { EventEmitter } from 'node:events';
import { isTabAlive, getTabInfo } from './tab-manager.mjs';

/**
 * @typedef {Object} MonitorEntry
 * @property {ReturnType<typeof setInterval>} interval
 * @property {number} lastCheck
 */

/**
 * @typedef {Object} HealthEntry
 * @property {boolean} alive
 * @property {number} lastSeen
 * @property {string|null|undefined} error
 */

/**
 * Tab Monitor - watches tab health and emits events
 */
export class TabMonitor extends EventEmitter {
    /**
     * @param {number} port
     */
    constructor(port) {
        super();
        this.port = port;
        /** @type {Map<string, MonitorEntry>} */
        this.monitors = new Map();
        /** @type {Map<string, HealthEntry>} */
        this.healthStatus = new Map();
    }

    /**
     * Start monitoring a tab
     * @param {string} targetId - Tab to monitor
     * @param {number} [intervalMs] - Check interval (default: 30000)
     */
    startMonitoring(targetId, intervalMs = 30000) {
        if (this.monitors.has(targetId)) {
            this.stopMonitoring(targetId);
        }

        const check = async () => {
            try {
                const alive = await isTabAlive(this.port, targetId);
                const previous = this.healthStatus.get(targetId);
                
                this.healthStatus.set(targetId, {
                    alive,
                    lastSeen: Date.now(),
                    error: null
                });

                if (!alive && previous?.alive) {
                    // Tab was closed
                    this.emit('tab:closed', { targetId });
                } else if (alive && !previous?.alive) {
                    // Tab recovered
                    this.emit('tab:recovered', { targetId });
                }

                this.emit('tab:health-check', { targetId, alive });
            } catch (error) {
                this.healthStatus.set(targetId, {
                    alive: false,
                    lastSeen: Date.now(),
                    error: /** @type {{ message?: string }} */ (error).message
                });
                this.emit('tab:crashed', { targetId, error: /** @type {{ message?: string }} */ (error).message });
            }
        };

        // Initial check
        check();
        
        // Schedule periodic checks
        const interval = setInterval(check, intervalMs);
        this.monitors.set(targetId, { interval, lastCheck: Date.now() });
    }

    /**
     * Stop monitoring a tab
     * @param {string} targetId - Tab to stop monitoring
     */
    stopMonitoring(targetId) {
        const monitor = this.monitors.get(targetId);
        if (monitor) {
            clearInterval(monitor.interval);
            this.monitors.delete(targetId);
            this.healthStatus.delete(targetId);
        }
    }

    /**
     * Stop all monitoring
     */
    stopAll() {
        for (const [targetId] of this.monitors) {
            this.stopMonitoring(targetId);
        }
    }

    /**
     * Get health status for a tab
     * @param {string} targetId 
     * @returns {HealthEntry|undefined}
     */
    getHealth(targetId) {
        return this.healthStatus.get(targetId);
    }

    /**
     * Get all monitored tabs
     * @returns {Array<{ targetId: string } & HealthEntry>}
     */
    getAllHealth() {
        return Array.from(this.healthStatus.entries()).map(([targetId, health]) => ({
            targetId,
            ...health
        }));
    }
}


/**
 * Create a tab monitor instance
 * @param {number} port - CDP port
 * @returns {TabMonitor}
 */
export function createTabMonitor(port) {
    return new TabMonitor(port);
}
