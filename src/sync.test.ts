import { describe, expect, it } from "vitest";
import * as Option from "@tt/std/option";

import { SyncState, cachedOrFetch, describeSync, syncWithRetry } from "./sync.tt";

/** n번 실패 후 성공하는 포트 + 호출 기록. */
const flakyPort = (failures: number, reject: () => unknown = () => new Error("네트워크 끊김")) => {
  let calls = 0;
  const port = async (payload: string): Promise<string> => {
    calls += 1;
    if (calls <= failures) throw reject();
    return `ok:${payload}:${calls}`;
  };
  return { port, callCount: () => calls };
};

const recordingWait = () => {
  const waited: number[] = [];
  const wait = async (attempt: number) => {
    waited.push(attempt);
  };
  return { wait, waited };
};

describe("syncWithRetry — 재시도 케이스 매트릭스", () => {
  it("첫 시도에 성공하면 대기 없이 Synced", async () => {
    const { port, callCount } = flakyPort(0);
    const { wait, waited } = recordingWait();
    expect(await syncWithRetry(port, "p", 3, wait)).toEqual(
      SyncState.Synced("ok:p:1"),
    );
    expect(callCount()).toBe(1);
    expect(waited).toEqual([]);
  });

  it("두 번 실패 후 성공 — 다음 시도 번호로 wait가 불림", async () => {
    const { port, callCount } = flakyPort(2);
    const { wait, waited } = recordingWait();
    expect(await syncWithRetry(port, "p", 3, wait)).toEqual(
      SyncState.Synced("ok:p:3"),
    );
    expect(callCount()).toBe(3);
    expect(waited).toEqual([2, 3]);
  });

  it("전부 실패하면 Failed(사유, 시도 횟수)", async () => {
    const { port, callCount } = flakyPort(99);
    const { wait } = recordingWait();
    expect(await syncWithRetry(port, "p", 2, wait)).toEqual(
      SyncState.Failed("네트워크 끊김", 2),
    );
    expect(callCount()).toBe(2);
  });

  it("Error가 아닌 reject 값(문자열)도 사유로 강등", async () => {
    const { port } = flakyPort(99, () => "서버 점검");
    const { wait } = recordingWait();
    expect(await syncWithRetry(port, "p", 1, wait)).toEqual(
      SyncState.Failed("서버 점검", 1),
    );
  });
});

describe("cachedOrFetch — 가드 안의 await", () => {
  const fresh = async () => 99;

  it("검증을 통과한 캐시는 그대로", async () => {
    expect(await cachedOrFetch(Option.Some(7), async () => true, fresh)).toBe(7);
  });

  it("검증 실패한 캐시는 버리고 새로 가져옴", async () => {
    expect(await cachedOrFetch(Option.Some(7), async () => false, fresh)).toBe(99);
  });

  it("캐시 없음이면 새로 가져옴 — 검증 함수는 호출조차 안 됨", async () => {
    let validated = false;
    const validate = async () => {
      validated = true;
      return true;
    };
    expect(await cachedOrFetch(Option.None, validate, fresh)).toBe(99);
    expect(validated).toBe(false);
  });
});

describe("describeSync — 상태 문구", () => {
  it("각 상태가 라벨로", () => {
    expect(describeSync(SyncState.Idle)).toBe("동기화 안 함");
    expect(describeSync(SyncState.Syncing(2))).toBe("동기화 중… (2번째 시도)");
    expect(describeSync(SyncState.Synced("어제"))).toBe("동기화됨 · 어제");
    expect(describeSync(SyncState.Failed("끊김", 3))).toBe(
      "동기화 3회 실패: 끊김",
    );
  });
});
