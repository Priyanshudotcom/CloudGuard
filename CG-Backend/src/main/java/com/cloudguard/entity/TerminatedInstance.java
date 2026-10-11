package com.cloudguard.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * One row per remediation action taken from the dashboard. "terminatedAt"
 * and "dailyWasteSaved" names are kept per spec even though the current
 * remediation action is a stop (see DashboardController) - status makes
 * the actual action explicit per row.
 */
@Entity
@Table(name = "terminated_instances")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class TerminatedInstance {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String instanceId;

    @Column(nullable = false)
    private String instanceType;

    @Column(nullable = false)
    private Instant terminatedAt;

    @Column(nullable = false)
    private double dailyWasteSaved;

    @Column(nullable = false)
    private String status;
}
