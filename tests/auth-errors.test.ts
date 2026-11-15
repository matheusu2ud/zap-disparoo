import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUnauthenticatedError } from "../src/lib/supabase/auth-errors";

describe("Supabase authentication errors", () => {
  it("recognizes missing and expired sessions as unauthenticated", () => {
    const missingSession = new Error("No session");
    missingSession.name = "AuthSessionMissingError";
    const expiredSession = Object.assign(new Error("Session expired"), {
      status: 401,
    });

    assert.equal(isUnauthenticatedError(missingSession), true);
    assert.equal(isUnauthenticatedError(expiredSession), true);
  });

  it("keeps other authentication failures visible", () => {
    assert.equal(isUnauthenticatedError(new Error("Network failure")), false);
    assert.equal(isUnauthenticatedError(null), false);
  });
});
