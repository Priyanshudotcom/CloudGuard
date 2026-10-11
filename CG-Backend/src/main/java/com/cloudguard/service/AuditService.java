package com.cloudguard.service;

import com.cloudguard.entity.TerminatedInstance;
import com.cloudguard.repository.TerminatedInstanceRepository;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

@Service
public class AuditService {

    private final TerminatedInstanceRepository repository;

    public AuditService(TerminatedInstanceRepository repository) {
        this.repository = repository;
    }

    public void recordTermination(String instanceId, String instanceType, double dailyWasteSaved, String status) {
        TerminatedInstance record = TerminatedInstance.builder()
                .instanceId(instanceId)
                .instanceType(instanceType)
                .terminatedAt(Instant.now())
                .dailyWasteSaved(dailyWasteSaved)
                .status(status)
                .build();
        repository.save(record);
    }

    public List<TerminatedInstance> getHistory() {
        return repository.findAllByOrderByTerminatedAtDesc();
    }

    public double getTotalDailyWasteSaved() {
        return repository.sumTotalDailyWasteSaved();
    }
}
