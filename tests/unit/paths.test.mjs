import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { safeJoin } from "../../src/storage/paths.mjs";

test("safeJoin allows paths inside base directory", () => {
    assert.equal(safeJoin("/tmp/base", "a/b.txt"), path.resolve("/tmp/base/a/b.txt"));
});

test("safeJoin rejects paths outside base directory", () => {
    assert.throws(() => safeJoin("/tmp/base", "../base2/file.txt"), /非法路径/);
    assert.throws(() => safeJoin("/tmp/base", "/tmp/base2/file.txt"), /非法路径/);
});

