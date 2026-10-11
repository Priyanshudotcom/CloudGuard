package com.cloudguard.repository;

import com.cloudguard.entity.TerminatedInstance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;

public interface TerminatedInstanceRepository extends JpaRepository<TerminatedInstance, Long> {

    List<TerminatedInstance> findAllByOrderByTerminatedAtDesc();

    @Query("SELECT COALESCE(SUM(t.dailyWasteSaved), 0) FROM TerminatedInstance t")
    double sumTotalDailyWasteSaved();
}
