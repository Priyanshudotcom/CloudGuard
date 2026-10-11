package com.cloudguard.service;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Deterministic-ish synthetic data used only when AWS is unreachable
 * (missing/invalid credentials, no network path, or CloudWatch/EC2
 * throttling). Lets zombie detection, cost calc, the dashboard, and the
 * stop/history flow all be demoed without a live AWS account.
 */
@Component
public class MockInstanceDataService {

    public List<MetricsPollerService.RunningInstanceInfo> mockRunningInstances() {
        return List.of(
                mockInstance("i-0aaaa1111bbbb2222", "t2.micro", 30),
                mockInstance("i-0cccc3333dddd4444", "t3.medium", 14),
                mockInstance("i-0eeee5555ffff6666", "m5.large", 3),
                mockInstance("i-0gggg7777hhhh8888", "t2.small", 60)
        );
    }

    public Map<String, MetricsPollerService.InstanceMetricSnapshot> mockMetrics(List<String> instanceIds) {
        Map<String, MetricsPollerService.InstanceMetricSnapshot> result = new HashMap<>();
        for (String id : instanceIds) {
            double cpu = ThreadLocalRandom.current().nextDouble(0.1, 8.0);
            double netIn = ThreadLocalRandom.current().nextDouble(0, 150_000);
            double netOut = ThreadLocalRandom.current().nextDouble(0, 150_000);
            result.put(id, new MetricsPollerService.InstanceMetricSnapshot(cpu, netIn, netOut));
        }
        return result;
    }

    private MetricsPollerService.RunningInstanceInfo mockInstance(String id, String type, int ageInDays) {
        Instant launch = Instant.now().minus(ageInDays, ChronoUnit.DAYS);
        return new MetricsPollerService.RunningInstanceInfo(
                id, type, launch.toString(), launch, Map.of("Name", "mock-" + id)
        );
    }
}
