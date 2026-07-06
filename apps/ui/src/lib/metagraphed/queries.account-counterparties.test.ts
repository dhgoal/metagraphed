import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "./client";
import { apiFetch } from "./client";
import { accountCounterpartiesQuery, normalizeAccountCounterparties } from "./queries";

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockedApiFetch = vi.mocked(apiFetch);
const SS58 = "5G9hfkx9wGB1CLMT9WXkpHSAiYzjZb5o1Boyq4KAdDhjwrc5";
const OTHER = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

function resolveWith(data: unknown): void {
  mockedApiFetch.mockResolvedValue({
    data,
    meta: {} as ApiResult<unknown>["meta"],
    url: `/api/v1/accounts/${SS58}/counterparties`,
  });
}

async function runQuery(ss58: string, limit?: number) {
  const opts = accountCounterpartiesQuery(ss58, limit);
  if (!opts.queryFn) throw new Error("expected a queryFn");
  return opts.queryFn({
    signal: new AbortController().signal,
    queryKey: opts.queryKey,
    meta: undefined,
  } as unknown as Parameters<NonNullable<typeof opts.queryFn>>[0]);
}

describe("normalizeAccountCounterparties", () => {
  it("passes a well-formed card through", () => {
    expect(
      normalizeAccountCounterparties(SS58, {
        schema_version: 1,
        ss58: SS58,
        counterparty_count: 2,
        transfers_scanned: 12,
        scan_capped: false,
        total_sent_tao: 30,
        total_received_tao: 18,
        counterparties: [
          {
            address: OTHER,
            sent_tao: 20,
            received_tao: 5,
            net_tao: -15,
            transfer_count: 7,
            last_block: 4_000_100,
          },
          {
            address: SS58,
            sent_tao: 10,
            received_tao: 13,
            net_tao: 3,
            transfer_count: 5,
            last_block: null,
          },
        ],
      }),
    ).toEqual({
      schema_version: 1,
      ss58: SS58,
      counterparty_count: 2,
      transfers_scanned: 12,
      scan_capped: false,
      total_sent_tao: 30,
      total_received_tao: 18,
      counterparties: [
        {
          address: OTHER,
          sent_tao: 20,
          received_tao: 5,
          net_tao: -15,
          transfer_count: 7,
          last_block: 4_000_100,
        },
        {
          address: SS58,
          sent_tao: 10,
          received_tao: 13,
          net_tao: 3,
          transfer_count: 5,
          last_block: null,
        },
      ],
    });
  });

  it("degrades a cold / junk store to a schema-stable zeroed card", () => {
    for (const raw of [{}, null, "x", { total_sent_tao: "nope", counterparties: "nope" }]) {
      const card = normalizeAccountCounterparties(SS58, raw);
      expect(card.ss58).toBe(SS58);
      expect(card.schema_version).toBe(1);
      expect(card.counterparty_count).toBe(0);
      expect(card.transfers_scanned).toBe(0);
      expect(card.scan_capped).toBe(false);
      expect(card.total_sent_tao).toBe(0);
      expect(card.total_received_tao).toBe(0);
      expect(card.counterparties).toEqual([]);
    }
  });

  it("drops counterparty rows lacking a valid address and never emits NaN", () => {
    const card = normalizeAccountCounterparties(SS58, {
      counterparties: [
        { address: OTHER, sent_tao: "bad", received_tao: null, transfer_count: "x" },
        { sent_tao: 5 },
        null,
      ],
    });
    expect(card.counterparties).toHaveLength(1);
    const row = card.counterparties[0];
    expect(row.address).toBe(OTHER);
    expect(row.sent_tao).toBe(0);
    expect(row.received_tao).toBe(0);
    expect(row.net_tao).toBe(0);
    expect(row.transfer_count).toBe(0);
    expect(row.last_block).toBeNull();
  });
});

describe("accountCounterpartiesQuery", () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it("passes the limit param and normalizes the card", async () => {
    resolveWith({ ss58: SS58, counterparty_count: 3, transfers_scanned: 9 });
    const res = await runQuery(SS58, 5);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `/api/v1/accounts/${SS58}/counterparties`,
      expect.objectContaining({ params: { limit: 5 } }),
    );
    expect(res.data.counterparty_count).toBe(3);
    expect(res.data.transfers_scanned).toBe(9);
  });

  it("omits the limit param when none is supplied", async () => {
    resolveWith({});
    await runQuery(SS58);
    expect(mockedApiFetch).toHaveBeenCalledWith(
      `/api/v1/accounts/${SS58}/counterparties`,
      expect.objectContaining({ params: {} }),
    );
  });
});
