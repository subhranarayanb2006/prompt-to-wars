# Domino Sky Firestore Security Specification (Phase 0)

## 1. Data Invariants & Master Source of Truth
1. **Default Deny**: All unmatched paths in `/databases/{database}/documents` are denied (`allow read, write: if false;`).
2. **PII Isolation (`users/{userId}`)**: `UserProfile` contains `email` and `displayName`. Access (`get`, `create`, `update`) is strictly limited to `request.auth.uid == userId` with `request.auth.token.email_verified == true`. Listing `/users` is forbidden (`allow list: if false`).
3. **Master Gate Relational Sync**: Every subcollection (`preferences`, `scenarios`, `logbook`) under `/users/{userId}` requires that the parent profile document `/users/{userId}` exists on `create`, `update`, and `get`, and strictly binds `ownerId == userId == request.auth.uid`.
4. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
5. **Terminal State Locking (`logbook`)**: Once a `ShiftLogEntry` reaches `status == 'resolved'`, no subsequent updates are permitted.
6. **Bounded Arrays & String Limits**: Every string checks `.size()` matching `firebase-blueprint.json` verbatim (`maxLength`), every ID matches `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and every array checks `.size() <= MAX` plus first-element type validation when non-empty.
7. **Secure List Queries**: `allow list` on `scenarios` and `logbook` strictly verifies `request.auth.uid == userId && resource.data.ownerId == request.auth.uid` with zero `get()`/`exists()` calls inside list rules.

## 2. The "Dirty Dozen" Adversarial Payloads (All MUST Return PERMISSION_DENIED)
1. **Unauthenticated Read**: Anonymous client calls `get(/users/alice)` -> DENIED.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` creates `/users/alice` -> DENIED.
3. **Cross-Tenant PII Read**: Authenticated `bob` calls `get(/users/alice)` -> DENIED.
4. **Identity Spoofing on Scenario Create**: Authenticated `bob` writes `/users/bob/scenarios/sc-1` with `ownerId: "alice"` -> DENIED.
5. **Shadow / Ghost Field Injection**: `alice` creates `/users/alice/scenarios/sc-1` including extra `"isAdmin": true` -> DENIED by `hasOnly(...)`.
6. **ID Poisoning**: `alice` writes `/users/alice/scenarios/bad..id$%` -> DENIED by `isValidId(scenarioId)`.
7. **Denial-of-Wallet Oversized String**: `alice` writes `ShiftLogEntry` with 5,000-character `notes` (`> 1000`) -> DENIED.
8. **Unbounded Array Injection**: `alice` writes `WorkspacePreferences` with 100 `watchlistIds` (`> 70`) -> DENIED.
9. **Array Type Poisoning**: `alice` writes `WorkspacePreferences` with `watchlistIds: [12345]` (integer instead of string) -> DENIED.
10. **Client-Forged Timestamp**: `alice` creates `SavedScenario` with backdated `createdAt` != `request.time` -> DENIED.
11. **Terminal State Bypass**: `alice` updates an already `status: "resolved"` `ShiftLogEntry` back to `status: "open"` -> DENIED.
12. **Orphaned Subcollection Write**: `alice` writes `/users/alice/logbook/log-1` before creating parent `/users/alice` -> DENIED by Master Gate `exists(...)`.
