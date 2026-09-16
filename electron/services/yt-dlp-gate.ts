class YtDlpOperationGate {
  private activeOperations = 0

  private maintenanceBarrier: Promise<void> | null = null

  private releaseMaintenance: (() => void) | null = null

  private readonly idleWaiters = new Set<() => void>()

  async runOperation<T>(operation: () => Promise<T>): Promise<T> {
    while (this.maintenanceBarrier) {
      await this.maintenanceBarrier
    }

    this.activeOperations += 1
    try {
      return await operation()
    } finally {
      this.activeOperations -= 1
      if (this.activeOperations === 0) {
        for (const resolve of this.idleWaiters) resolve()
        this.idleWaiters.clear()
      }
    }
  }

  async runMaintenance<T>(operation: () => Promise<T>): Promise<T> {
    while (this.maintenanceBarrier) {
      await this.maintenanceBarrier
    }

    this.maintenanceBarrier = new Promise<void>((resolve) => {
      this.releaseMaintenance = resolve
    })

    try {
      if (this.activeOperations > 0) {
        await new Promise<void>((resolve) => this.idleWaiters.add(resolve))
      }
      return await operation()
    } finally {
      const release = this.releaseMaintenance
      this.releaseMaintenance = null
      this.maintenanceBarrier = null
      release?.()
    }
  }
}

export const ytDlpOperationGate = new YtDlpOperationGate()
