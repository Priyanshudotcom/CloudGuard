package com.cloudguard.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class ZombieInstanceDTO {
    private String instanceId;
    private String instanceType;
    private double averageCpu;
    private double wastedCostDaily;
    private String launchTime;
    private String status;
}