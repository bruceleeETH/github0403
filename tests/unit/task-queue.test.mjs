import test from "node:test";
import assert from "node:assert/strict";
import { SerialTaskRunner, TaskBusyError } from "../../src/server/task-queue.mjs";

test("SerialTaskRunner rejects overlapping tasks and clears after completion", async () => {
    const runner = new SerialTaskRunner("test_task");
    let release = null;
    const first = runner.run("first task", () => new Promise((resolve) => {
        release = resolve;
    }));

    assert.equal(runner.getStatus().busy, true);
    await assert.rejects(
        () => runner.run("second task", () => "never"),
        (error) => error instanceof TaskBusyError && error.task.label === "first task"
    );

    release("done");
    assert.equal(await first, "done");
    assert.equal(runner.getStatus().busy, false);
});
