package com.cloudguard.service;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.exception.SdkClientException;
import software.amazon.awssdk.services.cloudwatch.CloudWatchClient;
import software.amazon.awssdk.services.cloudwatch.model.CloudWatchException;
import software.amazon.awssdk.services.cloudwatch.model.Dimension;
import software.amazon.awssdk.services.cloudwatch.model.GetMetricDataRequest;
import software.amazon.awssdk.services.cloudwatch.model.GetMetricDataResponse;
import software.amazon.awssdk.services.cloudwatch.model.Metric;
import software.amazon.awssdk.services.cloudwatch.model.MetricDataQuery;
import software.amazon.awssdk.services.cloudwatch.model.MetricDataResult;
import software.amazon.awssdk.services.cloudwatch.model.MetricStat;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.DescribeInstancesRequest;
import software.amazon.awssdk.services.ec2.model.DescribeInstancesResponse;
import software.amazon.awssdk.services.ec2.model.Ec2Exception;
import software.amazon.awssdk.services.ec2.model.Filter;
import software.amazon.awssdk.services.ec2.model.Instance;
import software.amazon.awssdk.services.ec2.model.Reservation;
import software.amazon.awssdk.services.ec2.model.Tag;

import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Infrastructure ingestion layer. Talks directly to the AWS EC2 and
 * CloudWatch APIs - no zombie/business logic lives here, that is the
 * responsibility of FinOpsLogicEngine.
 *
 * Falls back to synthetic data via MockInstanceDataService whenever AWS
 * credentials are missing/invalid or a call otherwise fails, so the rest
 * of the pipeline (and a live demo) keeps working without a real account.
 */
@Slf4j
@Service
public class MetricsPollerService {

    private static final int METRIC_LOOKBACK_HOURS = 12;
    private static final int MAX_METRIC_QUERIES_PER_CALL = 500; // AWS GetMetricData hard limit

    private final Ec2Client ec2Client;
    private final CloudWatchClient cloudWatchClient;
    private final MockInstanceDataService mockInstanceDataService;
    private final AtomicBoolean usingMockData = new AtomicBoolean(false);

    public MetricsPollerService(Ec2Client ec2Client, CloudWatchClient cloudWatchClient,
                                 MockInstanceDataService mockInstanceDataService) {
        this.ec2Client = ec2Client;
        this.cloudWatchClient = cloudWatchClient;
        this.mockInstanceDataService = mockInstanceDataService;
    }

    /** True if the most recent fetch (either method) fell back to mock data. */
    public boolean isUsingMockData() {
        return usingMockData.get();
    }

    /**
     * Queries EC2 for every instance currently in the "running" state.
     * Falls back to mock instances if AWS is unreachable.
     */
    public List<RunningInstanceInfo> fetchRunningInstances() {
        try {
            List<RunningInstanceInfo> runningInstances = new ArrayList<>();

            Filter stateFilter = Filter.builder()
                    .name("instance-state-name")
                    .values("running")
                    .build();

            DescribeInstancesRequest request = DescribeInstancesRequest.builder()
                    .filters(stateFilter)
                    .build();

            DescribeInstancesResponse response = ec2Client.describeInstances(request);

            for (Reservation reservation : response.reservations()) {
                for (Instance instance : reservation.instances()) {
                    Map<String, String> tags = new HashMap<>();
                    for (Tag tag : instance.tags()) {
                        tags.put(tag.key(), tag.value());
                    }

                    String launchTimeFormatted = DateTimeFormatter.ISO_INSTANT.format(instance.launchTime());

                    runningInstances.add(new RunningInstanceInfo(
                            instance.instanceId(),
                            instance.instanceTypeAsString(),
                            launchTimeFormatted,
                            instance.launchTime(),
                            tags
                    ));
                }
            }

            usingMockData.set(false);
            return runningInstances;

        } catch (Ec2Exception | SdkClientException e) {
            log.warn("AWS EC2 unreachable ({}). Falling back to mock instance data.", e.getMessage());
            usingMockData.set(true);
            return mockInstanceDataService.mockRunningInstances();
        }
    }

    /**
     * Batched CPU + Network fetch for every given instance in one CloudWatch
     * GetMetricData call (chunked at 500 queries, the AWS hard limit)
     * instead of N sequential GetMetricStatistics calls per instance -
     * this is what keeps a large fleet from hitting CloudWatch throttling.
     * Falls back to mock metrics if AWS is unreachable.
     */
    public Map<String, InstanceMetricSnapshot> fetchMetricsBatch(List<String> instanceIds) {
        Map<String, InstanceMetricSnapshot> result = new HashMap<>();
        if (instanceIds.isEmpty()) {
            return result;
        }

        Instant endTime = Instant.now();
        Instant startTime = endTime.minus(METRIC_LOOKBACK_HOURS, ChronoUnit.HOURS);
        int periodSeconds = Math.max(60, (int) Duration.between(startTime, endTime).getSeconds());

        // [averageCpu, networkInBytes, networkOutBytes] per instance
        Map<String, double[]> raw = new HashMap<>();
        for (String id : instanceIds) {
            raw.put(id, new double[3]);
        }

        try {
            List<MetricDataQuery> queries = buildMetricQueries(instanceIds, periodSeconds);

            for (List<MetricDataQuery> batch : partition(queries, MAX_METRIC_QUERIES_PER_CALL)) {
                GetMetricDataRequest request = GetMetricDataRequest.builder()
                        .startTime(startTime)
                        .endTime(endTime)
                        .metricDataQueries(batch)
                        .build();

                GetMetricDataResponse response = cloudWatchClient.getMetricData(request);

                for (MetricDataResult metricResult : response.metricDataResults()) {
                    applyMetricResult(raw, metricResult.id(), metricResult.values());
                }
            }

            usingMockData.set(false);

        } catch (CloudWatchException | SdkClientException e) {
            log.warn("CloudWatch unreachable ({}). Falling back to mock metrics for {} instance(s).",
                    e.getMessage(), instanceIds.size());
            usingMockData.set(true);
            return mockInstanceDataService.mockMetrics(instanceIds);
        }

        for (Map.Entry<String, double[]> entry : raw.entrySet()) {
            double[] v = entry.getValue();
            result.put(entry.getKey(), new InstanceMetricSnapshot(v[0], v[1], v[2]));
        }
        return result;
    }

    private List<MetricDataQuery> buildMetricQueries(List<String> instanceIds, int periodSeconds) {
        List<MetricDataQuery> queries = new ArrayList<>();
        for (String instanceId : instanceIds) {
            String safeId = sanitizeId(instanceId);
            Dimension dimension = Dimension.builder().name("InstanceId").value(instanceId).build();

            queries.add(metricQuery("cpu_" + safeId, "CPUUtilization", dimension, periodSeconds, "Average"));
            queries.add(metricQuery("netin_" + safeId, "NetworkIn", dimension, periodSeconds, "Sum"));
            queries.add(metricQuery("netout_" + safeId, "NetworkOut", dimension, periodSeconds, "Sum"));
        }
        return queries;
    }

    private MetricDataQuery metricQuery(String id, String metricName, Dimension dimension, int periodSeconds, String stat) {
        return MetricDataQuery.builder()
                .id(id)
                .metricStat(MetricStat.builder()
                        .metric(Metric.builder()
                                .namespace("AWS/EC2")
                                .metricName(metricName)
                                .dimensions(dimension)
                                .build())
                        .period(periodSeconds)
                        .stat(stat)
                        .build())
                .returnData(true)
                .build();
    }

    private void applyMetricResult(Map<String, double[]> raw, String queryId, List<Double> values) {
        if (values.isEmpty()) {
            return;
        }
        if (queryId.startsWith("cpu_")) {
            double[] arr = raw.get(unsanitizeId(queryId.substring(4)));
            if (arr != null) {
                arr[0] = values.stream().mapToDouble(Double::doubleValue).average().orElse(0.0);
            }
        } else if (queryId.startsWith("netin_")) {
            double[] arr = raw.get(unsanitizeId(queryId.substring(6)));
            if (arr != null) {
                arr[1] = values.stream().mapToDouble(Double::doubleValue).sum();
            }
        } else if (queryId.startsWith("netout_")) {
            double[] arr = raw.get(unsanitizeId(queryId.substring(7)));
            if (arr != null) {
                arr[2] = values.stream().mapToDouble(Double::doubleValue).sum();
            }
        }
    }

    // GetMetricData query ids only allow [a-z][a-zA-Z0-9_]* - EC2 instance
    // ids contain a hyphen, so swap it for an underscore and back. Safe
    // because EC2 instance ids never contain underscores themselves.
    private String sanitizeId(String instanceId) {
        return instanceId.replace('-', '_');
    }

    private String unsanitizeId(String safeId) {
        return safeId.replace('_', '-');
    }

    private static <T> List<List<T>> partition(List<T> list, int size) {
        List<List<T>> chunks = new ArrayList<>();
        for (int i = 0; i < list.size(); i += size) {
            chunks.add(list.subList(i, Math.min(i + size, list.size())));
        }
        return chunks;
    }

    /**
     * Lightweight carrier for raw EC2 instance data. Kept as a nested type
     * since it never leaves the service layer.
     */
    public static class RunningInstanceInfo {
        private final String instanceId;
        private final String instanceType;
        private final String launchTimeFormatted;
        private final Instant launchTimeRaw;
        private final Map<String, String> tags;

        public RunningInstanceInfo(String instanceId, String instanceType, String launchTimeFormatted,
                                    Instant launchTimeRaw, Map<String, String> tags) {
            this.instanceId = instanceId;
            this.instanceType = instanceType;
            this.launchTimeFormatted = launchTimeFormatted;
            this.launchTimeRaw = launchTimeRaw;
            this.tags = tags;
        }

        public String getInstanceId() { return instanceId; }
        public String getInstanceType() { return instanceType; }
        public String getLaunchTimeFormatted() { return launchTimeFormatted; }
        public Instant getLaunchTimeRaw() { return launchTimeRaw; }
        public Map<String, String> getTags() { return tags; }
    }

    /**
     * Combined CPU + network snapshot for one instance over the lookback
     * window. CPU is an average (%); network fields are total bytes summed
     * across the window (CloudWatch's Sum statistic) so totalNetworkKb()
     * represents actual traffic volume, not a per-period rate.
     */
    public static class InstanceMetricSnapshot {
        private final double averageCpu;
        private final double networkInBytes;
        private final double networkOutBytes;

        public InstanceMetricSnapshot() {
            this(0.0, 0.0, 0.0);
        }

        public InstanceMetricSnapshot(double averageCpu, double networkInBytes, double networkOutBytes) {
            this.averageCpu = averageCpu;
            this.networkInBytes = networkInBytes;
            this.networkOutBytes = networkOutBytes;
        }

        public double getAverageCpu() { return averageCpu; }
        public double getNetworkInBytes() { return networkInBytes; }
        public double getNetworkOutBytes() { return networkOutBytes; }

        public double totalNetworkKb() {
            return (networkInBytes + networkOutBytes) / 1024.0;
        }
    }
}
