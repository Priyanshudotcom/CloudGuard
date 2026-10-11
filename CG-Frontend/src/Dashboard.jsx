import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Server,
    AlertTriangle,
    DollarSign,
    Cpu,
    Clock,
    PowerOff,
    Loader2,
    CheckCircle2,
    XCircle,
    Search,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Activity,
    Copy,
    Check,
    X,
    Layers,
    TrendingDown,
    Zap,
    BarChart3,
    Cloud,
} from 'lucide-react';
import { fetchZombieInstances, fetchSummary, terminateInstance, terminateAllZombies, refreshFleet } from './services/api';

const REFRESH_INTERVAL_MS = 60000;

const Dashboard = () => {
    const [zombies, setZombies] = useState([]);
    const [totalRunning, setTotalRunning] = useState(0);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState(null);
    const [terminatingIds, setTerminatingIds] = useState(new Set());
    const [isBulkTerminating, setIsBulkTerminating] = useState(false);
    const [toast, setToast] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [confirmTarget, setConfirmTarget] = useState(null);
    const [confirmBulk, setConfirmBulk] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const [lastSyncTime, setLastSyncTime] = useState(new Date());

    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 4500);
    }, []);

    const loadZombies = useCallback(async () => {
        try {
            const [zombiesRes, summaryRes] = await Promise.all([fetchZombieInstances(), fetchSummary()]);
            setZombies(zombiesRes.data);
            setTotalRunning(summaryRes.data.totalRunningInstances);
            setLastSyncTime(new Date());
            setError(null);
        } catch (err) {
            setError('Failed to load zombie instances. Verify that the Spring Boot backend is running on port 8080.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadZombies();
        const interval = setInterval(loadZombies, REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [loadZombies]);

    const handleManualRefresh = async () => {
        setIsRefreshing(true);
        try {
            await refreshFleet();
            await loadZombies();
            showToast('Fleet cache synchronized with AWS CloudWatch.', 'success');
        } catch (err) {
            showToast('Failed to sync fleet telemetry with AWS.', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const executeStop = async (instanceId) => {
        setTerminatingIds((prev) => new Set(prev).add(instanceId));
        try {
            await terminateInstance(instanceId);
            setZombies((prev) => prev.filter((z) => z.instanceId !== instanceId));
            showToast(`Instance ${instanceId} stopped. Billing halted.`, 'success');
            loadZombies();
        } catch (err) {
            showToast(`Failed to stop instance ${instanceId}.`, 'error');
        } finally {
            setTerminatingIds((prev) => {
                const updated = new Set(prev);
                updated.delete(instanceId);
                return updated;
            });
        }
    };

    const executeBulkStop = async () => {
        setIsBulkTerminating(true);
        try {
            const res = await terminateAllZombies();
            setZombies([]);
            showToast(res.data.message || 'All flagged zombie instances stopped.', 'success');
            loadZombies();
        } catch (err) {
            showToast('Failed to execute bulk stop remediation.', 'error');
        } finally {
            setIsBulkTerminating(false);
            setConfirmBulk(false);
        }
    };

    const handleStopClick = (zombie) => setConfirmTarget(zombie);
    const handleCancelStop = () => setConfirmTarget(null);

    const handleConfirmStop = () => {
        if (!confirmTarget) return;
        const instanceId = confirmTarget.instanceId;
        setConfirmTarget(null);
        executeStop(instanceId);
    };

    const handleCopyId = (instanceId, e) => {
        e?.stopPropagation();
        navigator.clipboard?.writeText(instanceId);
        setCopiedId(instanceId);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const flaggedZombies = zombies.length;
    const totalDailyWaste = zombies.reduce((sum, z) => sum + z.wastedCostDaily, 0);
    const estimatedMonthlyWaste = totalDailyWaste * 30;

    const filteredZombies = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return zombies;
        return zombies.filter(
            (z) => z.instanceId.toLowerCase().includes(query) || z.instanceType.toLowerCase().includes(query)
        );
    }, [zombies, searchQuery]);

    const formatDate = (isoString) => {
        try {
            const date = new Date(isoString);
            return new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            }).format(date);
        } catch {
            return isoString;
        }
    };

    const formatRelativeTime = (isoString) => {
        try {
            const msDiff = Date.now() - new Date(isoString).getTime();
            const hours = Math.floor(msDiff / (1000 * 60 * 60));
            if (hours < 24) return `${hours}h ago`;
            const days = Math.floor(hours / 24);
            return `${days}d ago`;
        } catch {
            return '';
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#09090b] text-zinc-100 relative overflow-hidden">
                <div className="flex flex-col items-center gap-5 relative z-10">
                    <div className="relative flex items-center justify-center">
                        <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl flex items-center justify-center">
                            <Server className="w-7 h-7 text-emerald-400 animate-pulse" />
                        </div>
                        <div className="absolute -inset-1.5 rounded-2xl border-2 border-emerald-500/20 border-t-emerald-400 animate-spin" />
                    </div>
                    
                    <div className="text-center space-y-1">
                        <div className="flex items-center justify-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                            <p className="text-sm font-semibold tracking-wider text-zinc-200 uppercase">
                                Telemetry Scanner
                            </p>
                        </div>
                        <p className="text-xs text-zinc-500">Checking AWS eu-north-1 fleet heuristics...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-100 relative selection:bg-emerald-500/25 selection:text-emerald-200">
            {/* Background Ambient Neutral / Emerald Canvas (Zero Blue Tones) */}
            <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
                {/* Subtle emerald top aura */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[380px] bg-gradient-to-b from-emerald-500/[0.04] to-transparent blur-3xl" />
                {/* Fine neutral grid overlay */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#27272a0f_1px,transparent_1px),linear-gradient(to_bottom,#27272a0f_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
            </div>

            {/* Top Navigation Bar */}
            <header className="sticky top-0 z-30 border-b border-zinc-800/80 bg-[#09090b]/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
                    
                    {/* Brand & Fleet Status */}
                    <div className="flex items-center gap-3.5">
                        <div className="relative group">
                            <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-emerald-500/30 flex items-center justify-center shadow-lg shadow-black/60 group-hover:border-emerald-500/50 transition-colors">
                                <ShieldAlert className="w-5 h-5 text-emerald-400 transition-transform group-hover:scale-110" />
                            </div>
                            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                            </span>
                        </div>

                        <div>
                            <div className="flex items-center gap-2">
                                <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                                    CloudGuard
                                </span>
                                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                    LIVE TELEMETRY
                                </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                                <span className="flex items-center gap-1">
                                    <Cloud className="w-3 h-3 text-zinc-500" />
                                    AWS eu-north-1
                                </span>
                                <span>•</span>
                                <span>Sync: {lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                        </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex items-center gap-2.5">
                        <button
                            onClick={handleManualRefresh}
                            disabled={isRefreshing}
                            aria-label="Refresh Fleet Telemetry"
                            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 active:scale-[0.98] transition-all shadow-sm group disabled:opacity-60"
                        >
                            <RefreshCw className={`w-3.5 h-3.5 text-zinc-400 group-hover:text-emerald-400 transition-colors ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
                            <span className="hidden sm:inline">{isRefreshing ? 'Syncing...' : 'Refresh Fleet'}</span>
                        </button>

                        {zombies.length > 0 && (
                            <button
                                onClick={() => setConfirmBulk(true)}
                                disabled={isBulkTerminating}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-red-600 via-rose-600 to-red-600 hover:from-red-500 hover:to-rose-500 active:scale-[0.98] transition-all shadow-lg shadow-red-950/60 border border-red-500/30 disabled:opacity-50"
                            >
                                {isBulkTerminating ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <PowerOff className="w-3.5 h-3.5" />
                                )}
                                <span>Stop All Zombies</span>
                                <span className="bg-black/30 text-white/90 px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold">
                                    {zombies.length}
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
                
                {/* Simplified Clean Title / Overview Banner */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                        EC2 Zombie Monitor
                    </h1>

                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400 bg-zinc-900/80 border border-zinc-800/80 rounded-xl px-3.5 py-2 backdrop-blur-md self-start sm:self-auto">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Threshold: &lt;5.0% CPU (12h avg)</span>
                    </div>
                </div>

                {/* Error Banner */}
                {error && (
                    <div className="flex items-start sm:items-center justify-between gap-4 p-4 rounded-2xl bg-red-950/30 border border-red-900/50 backdrop-blur-xl text-red-200">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-red-900/30 border border-red-800/40 text-red-400">
                                <XCircle className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-red-100">Telemetry Communication Error</p>
                                <p className="text-xs text-red-300/80 mt-0.5">{error}</p>
                            </div>
                        </div>
                        <button
                            onClick={loadZombies}
                            className="text-xs font-medium bg-red-900/40 hover:bg-red-800/60 px-3 py-1.5 rounded-lg border border-red-800 text-red-100 transition-colors whitespace-nowrap"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {/* Summary Metric Cards (Zero-Blue Neutral/Emerald Grid) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    
                    {/* Metric 1: Total Running Fleet */}
                    <div className="relative rounded-2xl bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 p-6 overflow-hidden transition-all duration-300 hover:border-zinc-700 group shadow-lg">
                        {/* Top subtle highlight */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zinc-600/40 to-transparent" />
                        
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                                Monitored Fleet
                            </span>
                            <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-300 group-hover:scale-105 transition-transform">
                                <Server className="w-4 h-4" />
                            </div>
                        </div>

                        <div className="mt-4 flex items-baseline gap-2">
                            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-mono">
                                {totalRunning}
                            </span>
                            <span className="text-xs font-medium text-zinc-400">running instances</span>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                            <span className="text-zinc-400 flex items-center gap-1.5">
                                <Layers className="w-3.5 h-3.5 text-zinc-400" />
                                AWS eu-north-1
                            </span>
                            <span className="text-emerald-400 font-medium flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                Active Scan
                            </span>
                        </div>
                    </div>

                    {/* Metric 2: Flagged Zombies */}
                    <div className="relative rounded-2xl bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 p-6 overflow-hidden transition-all duration-300 hover:border-zinc-700 group shadow-lg">
                        {/* Top subtle highlight */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
                        
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                                Flagged Zombies
                            </span>
                            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 group-hover:scale-105 transition-transform">
                                <ShieldAlert className="w-4 h-4" />
                            </div>
                        </div>

                        <div className="mt-4 flex items-baseline gap-2">
                            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white font-mono">
                                {flaggedZombies}
                            </span>
                            <span className="text-xs font-medium text-amber-400">
                                {flaggedZombies === 1 ? 'instance idle' : 'instances idle'}
                            </span>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                            <span className="text-zinc-400 flex items-center gap-1.5">
                                <Activity className="w-3.5 h-3.5 text-amber-400" />
                                Idle Heuristics Triggered
                            </span>
                            <span className={`font-medium px-2 py-0.5 rounded-md text-[11px] ${flaggedZombies > 0 ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'}`}>
                                {flaggedZombies > 0 ? 'Remediation Ready' : 'Fleet Healthy'}
                            </span>
                        </div>
                    </div>

                    {/* Metric 3: Projected Daily & Monthly Waste */}
                    <div className="relative rounded-2xl bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 p-6 overflow-hidden transition-all duration-300 hover:border-zinc-700 group shadow-lg">
                        {/* Top subtle highlight */}
                        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
                        
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">
                                Projected Daily Waste
                            </span>
                            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                                <DollarSign className="w-4 h-4" />
                            </div>
                        </div>

                        <div className="mt-4 flex items-baseline gap-2">
                            <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-emerald-400 font-mono">
                                ${totalDailyWaste.toFixed(2)}
                            </span>
                            <span className="text-xs font-medium text-zinc-400">/ 24h cycle</span>
                        </div>

                        <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                            <span className="text-zinc-400 flex items-center gap-1.5">
                                <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />
                                Est. Monthly Recovery:
                            </span>
                            <span className="text-emerald-300 font-mono font-bold">
                                ~${estimatedMonthlyWaste.toFixed(2)}/mo
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main Content Card: Search Bar & Instances Table / Card List */}
                <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/80 rounded-2xl overflow-hidden shadow-2xl">
                    
                    {/* Filter & Search Header */}
                    <div className="p-5 sm:p-6 border-b border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-950/40">
                        <div>
                            <div className="flex items-center gap-2.5">
                                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                                    Idle Instance Candidates
                                </h2>
                                <span className="bg-zinc-800 text-zinc-300 text-xs font-mono font-medium px-2 py-0.5 rounded-full border border-zinc-700">
                                    {filteredZombies.length} of {zombies.length}
                                </span>
                            </div>
                            <p className="text-xs text-zinc-400 mt-0.5">
                                Instances with sustained idle CPU and minimal network I/O across the last 12 hours
                            </p>
                        </div>

                        {/* Search input */}
                        <div className="relative w-full md:w-80">
                            <Search className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Filter by ID (i-...) or type..."
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-9 py-2 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/80 transition-all font-mono"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery('')}
                                    aria-label="Clear search"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* State Renderings */}
                    {zombies.length === 0 ? (
                        /* Zero-Waste Celebratory Empty State */
                        <div className="py-20 px-6 text-center">
                            <div className="relative mx-auto w-16 h-16 mb-5">
                                <div className="absolute inset-0 rounded-2xl bg-emerald-500/20 blur-xl animate-pulse" />
                                <div className="relative w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
                                    <ShieldCheck className="w-8 h-8" />
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-zinc-100 tracking-tight">
                                Fleet is 100% Cost-Optimized
                            </h3>
                            <p className="text-zinc-400 text-xs sm:text-sm mt-1.5 max-w-md mx-auto leading-relaxed">
                                No idle zombie EC2 instances detected in eu-north-1. Scanner is actively monitoring all instances.
                            </p>
                            <div className="mt-6 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300">
                                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Zero unallocated compute spend currently detected</span>
                            </div>
                        </div>
                    ) : filteredZombies.length === 0 ? (
                        /* Search No-Match State */
                        <div className="py-16 px-6 text-center">
                            <div className="w-12 h-12 rounded-xl bg-zinc-800/50 border border-zinc-700/60 flex items-center justify-center mx-auto mb-3 text-zinc-500">
                                <Search className="w-5 h-5" />
                            </div>
                            <h3 className="text-sm font-semibold text-zinc-200">No matching instances found</h3>
                            <p className="text-xs text-zinc-400 mt-1">
                                No flagged zombies match your filter query &quot;<span className="text-zinc-300 font-mono">{searchQuery}</span>&quot;.
                            </p>
                            <button
                                onClick={() => setSearchQuery('')}
                                className="mt-4 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                            >
                                Clear Search Query
                            </button>
                        </div>
                    ) : (
                        /* Instance Items List */
                        <div className="divide-y divide-zinc-800/60">
                            {filteredZombies.map((zombie) => {
                                const isTerminating = terminatingIds.has(zombie.instanceId);
                                const isCopied = copiedId === zombie.instanceId;
                                const cpuPercent = Math.min(Math.max(zombie.averageCpu, 0), 100);

                                return (
                                    <div
                                        key={zombie.instanceId}
                                        className="p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5 hover:bg-zinc-850/40 transition-all duration-200 group"
                                    >
                                        {/* Left Side: Instance Identity & Telemetry */}
                                        <div className="flex-1 space-y-3">
                                            
                                            {/* Identity Row */}
                                            <div className="flex items-center gap-2.5 flex-wrap">
                                                {/* Instance ID Pill with Copy */}
                                                <button
                                                    onClick={(e) => handleCopyId(zombie.instanceId, e)}
                                                    title="Click to copy Instance ID"
                                                    className="inline-flex items-center gap-2 font-mono font-bold text-zinc-100 text-sm tracking-wide bg-zinc-950 hover:bg-zinc-900 px-3 py-1.5 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all group/copy shadow-sm"
                                                >
                                                    <span>{zombie.instanceId}</span>
                                                    {isCopied ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5 text-zinc-500 group-hover/copy:text-zinc-300 transition-colors" />
                                                    )}
                                                </button>

                                                {/* Instance Type */}
                                                <span className="text-xs font-mono font-medium bg-zinc-800/80 text-zinc-300 px-2.5 py-1 rounded-lg border border-zinc-700/60">
                                                    {zombie.instanceType}
                                                </span>

                                                {/* Idle State Badge */}
                                                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                                                    IDLE THRESHOLD MET
                                                </span>
                                            </div>

                                            {/* Telemetry Details */}
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                                                
                                                {/* Average CPU with mini gauge */}
                                                <div className="bg-zinc-950/70 border border-zinc-800/70 rounded-xl p-2.5 flex items-center justify-between gap-3">
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-300">
                                                            <Cpu className="w-3.5 h-3.5" />
                                                        </div>
                                                        <div>
                                                            <span className="text-zinc-400 text-[11px] block">Average CPU</span>
                                                            <span className="font-mono font-bold text-zinc-200">
                                                                {zombie.averageCpu.toFixed(2)}%
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {/* Mini bar gauge */}
                                                    <div className="w-16 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                                                        <div
                                                            className="bg-amber-400 h-full rounded-full"
                                                            style={{ width: `${Math.max(cpuPercent * 10, 4)}%` }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Launch Time */}
                                                <div className="bg-zinc-950/70 border border-zinc-800/70 rounded-xl p-2.5 flex items-center gap-2.5">
                                                    <div className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400">
                                                        <Clock className="w-3.5 h-3.5" />
                                                    </div>
                                                    <div className="overflow-hidden">
                                                        <span className="text-zinc-400 text-[11px] block">Launched</span>
                                                        <span className="font-mono text-zinc-200 truncate block" title={zombie.launchTime}>
                                                            {formatDate(zombie.launchTime)}
                                                            <span className="text-zinc-500 ml-1">({formatRelativeTime(zombie.launchTime)})</span>
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Wasted Cost Pill */}
                                                <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-2.5 flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2">
                                                        <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                                                            <DollarSign className="w-3.5 h-3.5" />
                                                        </div>
                                                        <div>
                                                            <span className="text-emerald-400/80 text-[11px] block">Wasted Cost</span>
                                                            <span className="font-mono font-bold text-emerald-400">
                                                                ${zombie.wastedCostDaily.toFixed(2)}
                                                                <span className="text-[10px] font-normal text-zinc-400 ml-1">/day</span>
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] text-zinc-400 font-mono hidden sm:inline">
                                                        ~${(zombie.wastedCostDaily * 30).toFixed(0)}/mo
                                                    </span>
                                                </div>

                                            </div>
                                        </div>

                                        {/* Right Side: Remediation Action Button */}
                                        <div className="lg:pl-6 flex items-center justify-end">
                                            <button
                                                onClick={() => handleStopClick(zombie)}
                                                disabled={isTerminating}
                                                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:text-white bg-red-500/10 hover:bg-red-600 border border-red-500/20 hover:border-red-600 active:scale-[0.98] transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none group/btn whitespace-nowrap"
                                            >
                                                {isTerminating ? (
                                                    <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                                                ) : (
                                                    <PowerOff className="w-3.5 h-3.5 transition-transform group-hover/btn:scale-110" />
                                                )}
                                                <span>{isTerminating ? 'Terminating...' : 'Stop Instance'}</span>
                                            </button>
                                        </div>

                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer Info / AWS Best Practices Callout */}
                <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 text-xs text-zinc-400 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5">
                        <BarChart3 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                        <span>CloudGuard automated stop signals trigger AWS EC2 state preservation. Instances can be restarted from the AWS console anytime.</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500 whitespace-nowrap">CloudGuard eu-north-1</span>
                </div>

            </main>

            {/* Single Stop Confirmation Modal (v0 Dialog) */}
            {confirmTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 overflow-hidden">
                        
                        {/* Hazard ambient accent */}
                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-red-500/15 rounded-full blur-2xl pointer-events-none" />
                        
                        {/* Header */}
                        <div className="flex items-start gap-4">
                            <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 flex-shrink-0">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-zinc-100 tracking-tight">Confirm EC2 Remediation</h3>
                                <p className="text-xs text-zinc-400 mt-0.5">Execute graceful shutdown on flagged instance</p>
                            </div>
                        </div>

                        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                            Sending a stop signal will cleanly suspend the virtual machine and halt hourly compute charges. Root EBS volumes and configuration will remain intact.
                        </p>

                        {/* Breakdown Box */}
                        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs font-mono">
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Target Instance</span>
                                <span className="text-zinc-100 font-bold">{confirmTarget.instanceId}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Type</span>
                                <span className="text-zinc-200">{confirmTarget.instanceType}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">12h Avg CPU</span>
                                <span className="text-amber-400 font-semibold">{confirmTarget.averageCpu.toFixed(2)}%</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
                                <span className="text-zinc-400 uppercase tracking-wider text-[10px]">Daily Savings Recovered</span>
                                <span className="text-emerald-400 font-bold text-sm">
                                    +${confirmTarget.wastedCostDaily.toFixed(2)}/day
                                </span>
                            </div>
                        </div>

                        {/* Modal Action Buttons */}
                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                onClick={handleCancelStop}
                                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-750 border border-zinc-700/60 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmStop}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 active:scale-[0.98] transition-all shadow-lg shadow-red-950/60"
                            >
                                <PowerOff className="w-3.5 h-3.5" />
                                Stop Instance Now
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk Stop Confirmation Modal */}
            {confirmBulk && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
                    <div className="relative bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 overflow-hidden">
                        
                        {/* Hazard ambient accent */}
                        <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-24 bg-red-500/20 rounded-full blur-2xl pointer-events-none" />
                        
                        <div className="flex items-start gap-4">
                            <div className="w-11 h-11 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 flex-shrink-0">
                                <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-zinc-100 tracking-tight">Bulk Remediation Confirmation</h3>
                                <p className="text-xs text-zinc-400 mt-0.5">Fleet-wide shutdown trigger</p>
                            </div>
                        </div>

                        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
                            You are about to issue stop signals to all <strong className="text-white font-bold">{zombies.length}</strong> identified zombie instances simultaneously.
                        </p>

                        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-2 text-xs font-mono">
                            <div className="flex justify-between items-center">
                                <span className="text-zinc-500 uppercase tracking-wider text-[10px]">Total Instances Affected</span>
                                <span className="text-zinc-100 font-bold">{zombies.length} EC2 instances</span>
                            </div>
                            <div className="flex justify-between items-center pt-2 border-t border-zinc-800">
                                <span className="text-zinc-400 uppercase tracking-wider text-[10px]">Total Immediate Daily Savings</span>
                                <span className="text-emerald-400 font-bold text-sm">
                                    +${totalDailyWaste.toFixed(2)}/day
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-[11px] text-zinc-400">
                                <span>Projected Annual Savings</span>
                                <span className="text-emerald-300 font-bold">
                                    ~${(totalDailyWaste * 365).toFixed(2)}/yr
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                                onClick={() => setConfirmBulk(false)}
                                className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-750 border border-zinc-700/60 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeBulkStop}
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-500 active:scale-[0.98] transition-all shadow-lg shadow-red-950/60"
                            >
                                <PowerOff className="w-3.5 h-3.5" />
                                Stop All {zombies.length} Zombies
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Toast Notification System */}
            {toast && (
                <div
                    className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-200 max-w-sm sm:max-w-md ${
                        toast.type === 'success'
                            ? 'bg-zinc-900/95 border-emerald-500/40 text-zinc-100'
                            : 'bg-zinc-900/95 border-red-500/40 text-zinc-100'
                    }`}
                >
                    <div className={`p-1.5 rounded-lg ${toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                        {toast.type === 'success' ? (
                            <CheckCircle2 className="w-4 h-4" />
                        ) : (
                            <XCircle className="w-4 h-4" />
                        )}
                    </div>
                    <span className="text-xs sm:text-sm font-medium flex-1">{toast.message}</span>
                    <button
                        onClick={() => setToast(null)}
                        className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Dashboard;