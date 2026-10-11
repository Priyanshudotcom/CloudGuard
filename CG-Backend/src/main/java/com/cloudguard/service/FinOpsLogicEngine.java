package com.cloudguard.service;

import com.cloudguard.dto.ZombieInstanceDTO;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Deterministic zombie-detection heuristic. An instance is classified as
 * a zombie only if BOTH hold over the trailing 12-hour window:
 *   - average CPUUtilization is strictly below ZOMBIE_CPU_THRESHOLD
 *   - total NetworkIn + NetworkOut is strictly below ZOMBIE_NETWORK_KB_THRESHOLD
 * Instances tagged Environment=Production or FinOpsIgnore=true are never
 * evaluated or flagged, regardless of how idle they look. No ML, no
 * external database - the evaluated list is cached in memory and
 * refreshed hourly.
 */
@Slf4j
@Service
public class FinOpsLogicEngine {

    private static final double ZOMBIE_CPU_THRESHOLD = 5.0;
    // NOTE: 100 KB total traffic over 12h is an intentionally strict
    // literal reading of the spec - in practice most instances (even
    // truly idle ones) exceed this from OS/agent background chatter
    // alone. Tune this constant if the real fleet needs a looser bar.
    private static final double ZOMBIE_NETWORK_KB_THRESHOLD = 100.0;
    private static final double HOURS_PER_DAY = 24.0;

    private static final String TAG_ENVIRONMENT = "Environment";
    private static final String TAG_ENVIRONMENT_PROTECTED_VALUE = "Production";
    private static final String TAG_FINOPS_IGNORE = "FinOpsIgnore";

    private final MetricsPollerService metricsPollerService;
    private final CostCalculator costCalculator;

    private final AtomicReference<List<ZombieInstanceDTO>> cachedZombies =
            new AtomicReference<>(Collections.emptyList());

    // Tracks total running-instance count alongside the zombie cache, purely
    // so the dashboard's "Total Running Instances" summary card reflects a
    // real number rather than reusing the flagged-zombie count.
    private final AtomicReference<Integer> cachedRunningInstanceCount = new AtomicReference<>(0);

    public FinOpsLogicEngine(MetricsPollerService metricsPollerService, CostCalculator costCalculator) {
        this.metricsPollerService = metricsPollerService;
        this.costCalculator = costCalculator;
    }

    /**
     * Populates the cache once at startup so /api/zombies doesn't return
     * an empty list until the first hourly cron tick.
     */
    @PostConstruct
    public void init() {
        log.info("Running initial zombie instance evaluation on startup...");
        cachedZombies.set(runEvaluation());
    }

    /**
     * Polls EC2 + CloudWatch and re-evaluates the entire fleet every hour,
     * on the hour.
     */
    @Scheduled(cron = "0 0 * * * *")
    public void evaluateInstances() {
        log.info("Starting scheduled zombie instance evaluation...");
        List<ZombieInstanceDTO> zombies = runEvaluation();
        cachedZombies.set(zombies);
        log.info("Evaluation complete. {} zombie instance(s) flagged.", zombies.size());
    }

    /**
     * Core evaluation pass: fetch running instances, exclude
     * production/ignore-tagged ones, batch-fetch CPU+network for the rest,
     * and apply the deterministic zombie rule.
     */
    public List<ZombieInstanceDTO> runEvaluation() {
        List<ZombieInstanceDTO> zombies = new ArrayList<>();

        List<MetricsPollerService.RunningInstanceInfo> runningInstances = metricsPollerService.fetchRunningInstances();
        cachedRunningInstanceCount.set(runningInstances.size());

        List<MetricsPollerService.RunningInstanceInfo> eligibleInstances = new ArrayList<>();
        for (MetricsPollerService.RunningInstanceInfo instance : runningInstances) {
            if (isProductionProtected(instance.getTags())) {
                log.debug("Skipping protected instance {} (Environment=Production or FinOpsIgnore=true)",
                        instance.getInstanceId());
                continue;
            }
            eligibleInstances.add(instance);
        }

        List<String> eligibleIds = new ArrayList<>();
        for (MetricsPollerService.RunningInstanceInfo instance : eligibleInstances) {
            eligibleIds.add(instance.getInstanceId());
        }

        Map<String, MetricsPollerService.InstanceMetricSnapshot> metricsByInstance =
                metricsPollerService.fetchMetricsBatch(eligibleIds);

        for (MetricsPollerService.RunningInstanceInfo instance : eligibleInstances) {
            MetricsPollerService.InstanceMetricSnapshot snapshot = metricsByInstance.getOrDefault(
                    instance.getInstanceId(), new MetricsPollerService.InstanceMetricSnapshot());

            boolean cpuIdle = snapshot.getAverageCpu() < ZOMBIE_CPU_THRESHOLD;
            boolean networkIdle = snapshot.totalNetworkKb() < ZOMBIE_NETWORK_KB_THRESHOLD;

            if (cpuIdle && networkIdle) {
                double dailyWaste = costCalculator.calculateWastedCost(instance.getInstanceType(), HOURS_PER_DAY);

                ZombieInstanceDTO dto = ZombieInstanceDTO.builder()
                        .instanceId(instance.getInstanceId())
                        .instanceType(instance.getInstanceType())
                        .averageCpu(round2(snapshot.getAverageCpu()))
                        .wastedCostDaily(round2(dailyWaste))
                        .launchTime(instance.getLaunchTimeFormatted())
                        .status("IDLE")
                        .build();

                zombies.add(dto);
            }
        }
        return zombies;
    }

    private boolean isProductionProtected(Map<String, String> tags) {
        if (tags == null || tags.isEmpty()) {
            return false;
        }
        boolean isProdEnv = TAG_ENVIRONMENT_PROTECTED_VALUE.equalsIgnoreCase(tags.get(TAG_ENVIRONMENT));
        boolean ignoreFlagSet = "true".equalsIgnoreCase(tags.get(TAG_FINOPS_IGNORE));
        return isProdEnv || ignoreFlagSet;
    }

    public List<ZombieInstanceDTO> getCachedZombies() {
        return cachedZombies.get();
    }

    public int getCachedRunningInstanceCount() {
        return cachedRunningInstanceCount.get();
    }

    /** Surfaces whether the last evaluation used live AWS data or the mock fallback. */
    public boolean isUsingMockData() {
        return metricsPollerService.isUsingMockData();
    }

    /** Forces an immediate re-evaluation, bypassing the hourly cron schedule. */
    public void refreshNow() {
        cachedZombies.set(runEvaluation());
    }

    /** Drops a single instance from the cache, e.g. right after a successful stop. */
    public void removeFromCache(String instanceId) {
        List<ZombieInstanceDTO> updated = new ArrayList<>(cachedZombies.get());
        updated.removeIf(z -> z.getInstanceId().equals(instanceId));
        cachedZombies.set(updated);
    }

    private double round2(double value) {
        return Math.round(value * 100.0) / 100.0;
    }
}
