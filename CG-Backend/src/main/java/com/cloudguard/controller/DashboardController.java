package com.cloudguard.controller;

import com.cloudguard.dto.ZombieInstanceDTO;
import com.cloudguard.entity.TerminatedInstance;
import com.cloudguard.service.AuditService;
import com.cloudguard.service.FinOpsLogicEngine;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import software.amazon.awssdk.services.ec2.Ec2Client;
import software.amazon.awssdk.services.ec2.model.Ec2Exception;
import software.amazon.awssdk.services.ec2.model.InstanceStateChange;
import software.amazon.awssdk.services.ec2.model.InstanceStateName;
import software.amazon.awssdk.services.ec2.model.StopInstancesRequest;
import software.amazon.awssdk.services.ec2.model.StopInstancesResponse;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Slf4j
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class DashboardController {

    private final FinOpsLogicEngine finOpsLogicEngine;
    private final Ec2Client ec2Client;
    private final AuditService auditService;

    public DashboardController(FinOpsLogicEngine finOpsLogicEngine, Ec2Client ec2Client, AuditService auditService) {
        this.finOpsLogicEngine = finOpsLogicEngine;
        this.ec2Client = ec2Client;
        this.auditService = auditService;
    }

    @GetMapping("/zombies")
    public ResponseEntity<List<ZombieInstanceDTO>> getZombieInstances() {
        return ResponseEntity.ok(finOpsLogicEngine.getCachedZombies());
    }

    /**
     * Not in the original spec's endpoint list, but /api/zombies alone
     * can't power a "Total Running Instances" stat card since it only
     * returns the flagged subset. dataSource tells the frontend/demo
     * whether the numbers are live AWS data or the mock fallback.
     */
    @GetMapping("/summary")
    public ResponseEntity<Map<String, Object>> getSummary() {
        List<ZombieInstanceDTO> zombies = finOpsLogicEngine.getCachedZombies();
        double totalDailyWaste = zombies.stream().mapToDouble(ZombieInstanceDTO::getWastedCostDaily).sum();

        return ResponseEntity.ok(Map.of(
                "totalRunningInstances", finOpsLogicEngine.getCachedRunningInstanceCount(),
                "flaggedZombies", zombies.size(),
                "totalDailyWaste", Math.round(totalDailyWaste * 100.0) / 100.0,
                "dataSource", finOpsLogicEngine.isUsingMockData() ? "mock" : "live"
        ));
    }

    @GetMapping("/history")
    public ResponseEntity<Map<String, Object>> getHistory() {
        List<TerminatedInstance> history = auditService.getHistory();
        double totalSaved = auditService.getTotalDailyWasteSaved();

        return ResponseEntity.ok(Map.of(
                "history", history,
                "totalDailyWasteSaved", Math.round(totalSaved * 100.0) / 100.0
        ));
    }

    /**
     * Route path kept as /terminate to match the original API contract,
     * but the underlying AWS call is StopInstancesRequest (reversible),
     * not TerminateInstancesRequest (which deletes the instance). Every
     * successful stop is persisted to the H2 audit table before the
     * response is returned.
     */
    @PostMapping("/terminate/{instanceId}")
    public ResponseEntity<Map<String, String>> stopInstance(@PathVariable String instanceId) {
        try {
            StopInstancesRequest request = StopInstancesRequest.builder()
                    .instanceIds(instanceId)
                    .build();

            StopInstancesResponse response = ec2Client.stopInstances(request);

            boolean transitioned = response.stoppingInstances().stream()
                    .anyMatch(this::isStoppingOrStopped);

            if (!transitioned) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(Map.of(
                                "instanceId", instanceId,
                                "message", "Instance did not transition to a stopping state."
                        ));
            }

            Optional<ZombieInstanceDTO> matched = finOpsLogicEngine.getCachedZombies().stream()
                    .filter(z -> z.getInstanceId().equals(instanceId))
                    .findFirst();

            String instanceType = matched.map(ZombieInstanceDTO::getInstanceType).orElse("UNKNOWN");
            double dailyWasteSaved = matched.map(ZombieInstanceDTO::getWastedCostDaily).orElse(0.0);

            finOpsLogicEngine.removeFromCache(instanceId);
            auditService.recordTermination(instanceId, instanceType, dailyWasteSaved, "STOPPED");

            return ResponseEntity.ok(Map.of(
                    "instanceId", instanceId,
                    "message", "Instance stop initiated successfully."
            ));

        } catch (Ec2Exception e) {
            String errorMessage = e.awsErrorDetails() != null ? e.awsErrorDetails().errorMessage() : e.getMessage();
            log.error("Failed to stop instance {}: {}", instanceId, errorMessage);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of(
                            "instanceId", instanceId,
                            "message", "Failed to stop instance: " + errorMessage
                    ));
        }
    }

    /**
     * Bulk remediation endpoint to shut down all currently flagged zombie instances at once.
     */
    @PostMapping("/terminate-all")
    public ResponseEntity<Map<String, Object>> stopAllZombies() {
        try {
            List<ZombieInstanceDTO> zombies = finOpsLogicEngine.getCachedZombies();

            if (zombies.isEmpty()) {
                return ResponseEntity.ok(Map.of(
                        "message", "No zombie instances found to stop.",
                        "stoppedCount", 0
                ));
            }

            List<String> zombieIds = zombies.stream()
                    .map(ZombieInstanceDTO::getInstanceId)
                    .toList();

            StopInstancesRequest request = StopInstancesRequest.builder()
                    .instanceIds(zombieIds)
                    .build();

            ec2Client.stopInstances(request);

            int successCount = 0;
            for (ZombieInstanceDTO zombie : zombies) {
                finOpsLogicEngine.removeFromCache(zombie.getInstanceId());
                auditService.recordTermination(
                        zombie.getInstanceId(),
                        zombie.getInstanceType(),
                        zombie.getWastedCostDaily(),
                        "STOPPED"
                );
                successCount++;
            }

            return ResponseEntity.ok(Map.of(
                    "message", "Successfully triggered stop command for all zombies.",
                    "stoppedCount", successCount,
                    "instanceIds", zombieIds
            ));

        } catch (Ec2Exception e) {
            String errorMessage = e.awsErrorDetails() != null ? e.awsErrorDetails().errorMessage() : e.getMessage();
            log.error("Failed to stop all zombie instances: {}", errorMessage);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to stop zombies: " + errorMessage));
        }
    }

    private boolean isStoppingOrStopped(InstanceStateChange change) {
        InstanceStateName state = change.currentState().name();
        return state == InstanceStateName.STOPPING || state == InstanceStateName.STOPPED;
    }
    @PostMapping("/refresh")
    public ResponseEntity<Map<String, String>> forceRefresh() {
        try {
            finOpsLogicEngine.refreshNow();
            return ResponseEntity.ok(Map.of("message", "Fleet cache refreshed successfully from AWS."));
        } catch (Exception e) {
            log.error("Failed to refresh fleet cache: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("message", "Failed to refresh fleet: " + e.getMessage()));
        }
    }
}