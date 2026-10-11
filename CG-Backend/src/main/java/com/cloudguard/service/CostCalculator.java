package com.cloudguard.service;

import org.springframework.stereotype.Service;

@Service
public class CostCalculator {

    /**
     * Calculates the accrued financial waste for a given instance type over a specified duration.
     */
    public double calculateWastedCost(String instanceType, double uptimeHours) {
        double hourlyRate = getHourlyRate(instanceType);
        return uptimeHours * hourlyRate;
    }

    /**
     * Maps specific AWS EC2 instance types to their standard hourly on-demand billing rates.
     */
    private double getHourlyRate(String instanceType) {
        if (instanceType == null) {
            return 0.05;
        }

        switch (instanceType.toLowerCase()) {
            case "t2.micro":
                return 0.0116;
            case "t3.medium":
                return 0.0416;
            case "m5.large":
                return 0.096;
            default:
                // Fallback default rate for unmapped instance types
                return 0.05;
        }
    }
}