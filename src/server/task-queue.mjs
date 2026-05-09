export class TaskBusyError extends Error {
    constructor(message, task = null) {
        super(message);
        this.name = "TaskBusyError";
        this.task = task;
    }
}

export class SerialTaskRunner {
    constructor(name) {
        this.name = name;
        this.activeTask = null;
    }

    getStatus() {
        if (!this.activeTask) {
            return { name: this.name, busy: false };
        }

        return {
            name: this.name,
            busy: true,
            task: {
                id: this.activeTask.id,
                label: this.activeTask.label,
                started_at: this.activeTask.startedAt,
            },
        };
    }

    async run(label, callback) {
        if (this.activeTask) {
            throw new TaskBusyError(`${this.activeTask.label || this.name} 正在运行，请稍后再试`, this.getStatus().task);
        }

        const task = {
            id: `${this.name}_${process.pid}_${Date.now()}`,
            label,
            startedAt: new Date().toISOString(),
        };
        this.activeTask = task;

        try {
            return await callback(task);
        } finally {
            if (this.activeTask?.id === task.id) {
                this.activeTask = null;
            }
        }
    }
}

export function taskBusyPayload(error) {
    return {
        error: error.message || "任务正在运行",
        task: error.task || null,
    };
}
