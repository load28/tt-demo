import { describe, expect, it } from "vitest";
import type { TOption, TResult } from "@tt/std";
import * as Option from "@tt/std/option";

import {
  Action,
  DueStatus,
  Filter,
  Priority,
  Progress,
  TodoError,
  type Todo,
  dueBadge,
  dueStatusOf,
  emptyMessage,
  parseTodo,
  progressLabel,
  sortTodos,
  undoAction,
} from "./todo.tt";

const unwrap = <T, E>(result: TResult<T, E>): T => {
  if ("value" in result) return result.value;
  throw new Error(`expected Ok, got ${JSON.stringify(result)}`);
};

const unwrapErr = <T, E>(result: TResult<T, E>): E => {
  if ("value" in result) throw new Error("expected Err, got Ok");
  return result.error;
};

const todo = (id: number, over: Partial<Todo> = {}): Todo => ({
  id,
  text: `할 일 ${id}`,
  done: false,
  priority: Priority.Medium,
  due: Option.None,
  ...over,
});

const TODAY = "2026-09-01";

describe("parseTodo — 입력 검증 케이스", () => {
  it("빈 문자열과 공백만 있는 입력은 Empty", () => {
    expect(unwrapErr(parseTodo("", []))).toEqual(TodoError.Empty);
    expect(unwrapErr(parseTodo("   \t ", []))).toEqual(TodoError.Empty);
  });

  it("정규화: 앞뒤 공백 제거, 연속 공백은 하나로", () => {
    expect(unwrap(parseTodo("  청소   하기  ", []))).toBe("청소 하기");
  });

  it("정규화 이후 기준으로 중복을 판정", () => {
    const existing = [todo(1, { text: "청소 하기" })];
    expect(unwrapErr(parseTodo("청소    하기", existing))).toEqual(
      TodoError.Duplicate("청소 하기"),
    );
  });

  it("80자 초과는 TooLong(80)", () => {
    expect(unwrapErr(parseTodo("가".repeat(81), []))).toEqual(
      TodoError.TooLong(80),
    );
  });
});

describe("dueStatusOf — 달력 경계 케이스", () => {
  const at = (due: TOption<string>) => dueStatusOf(todo(1, { due }), TODAY);

  it("마감일 없음 → NoDue", () => {
    expect(at(Option.None)).toEqual(DueStatus.NoDue);
  });

  it("손상된 날짜 문자열은 NoDue로 강등", () => {
    expect(at(Option.Some("어제쯤"))).toEqual(DueStatus.NoDue);
    expect(at(Option.Some("2026-9-1"))).toEqual(DueStatus.NoDue);
  });

  it("같은 달력 날짜 → DueToday", () => {
    expect(at(Option.Some("2026-09-01"))).toEqual(DueStatus.DueToday);
  });

  it("내일 → Upcoming(1), 월 경계를 넘어도 일수 정확", () => {
    expect(at(Option.Some("2026-09-02"))).toEqual(DueStatus.Upcoming(1));
    expect(at(Option.Some("2026-10-01"))).toEqual(DueStatus.Upcoming(30));
  });

  it("어제 → Overdue(1)", () => {
    expect(at(Option.Some("2026-08-31"))).toEqual(DueStatus.Overdue(1));
  });
});

describe("dueBadge — 표시 정책", () => {
  it("3일 이내 임박만 표시, 먼 미래는 숨김", () => {
    expect(dueBadge(DueStatus.Upcoming(3))).toEqual(Option.Some("3일 남음"));
    expect(dueBadge(DueStatus.Upcoming(4))).toEqual(Option.None);
  });

  it("지난 것과 오늘은 항상 표시", () => {
    expect(dueBadge(DueStatus.Overdue(2))).toEqual(Option.Some("2일 지남"));
    expect(dueBadge(DueStatus.DueToday)).toEqual(Option.Some("오늘까지"));
  });
});

describe("sortTodos — 마감 > 우선순위 > 추가 순", () => {
  it("지남 → 오늘 → 임박 → 없음 순으로 정렬", () => {
    const list = [
      todo(1),
      todo(2, { due: Option.Some("2026-09-05") }),
      todo(3, { due: Option.Some("2026-09-01") }),
      todo(4, { due: Option.Some("2026-08-20") }),
    ];
    expect(sortTodos(list, TODAY).map((t) => t.id)).toEqual([4, 3, 2, 1]);
  });

  it("같은 마감 상태 안에서는 긴급이 먼저", () => {
    const list = [
      todo(1, { priority: Priority.Low }),
      todo(2, { priority: Priority.High }),
      todo(3, { priority: Priority.Medium }),
    ];
    expect(sortTodos(list, TODAY).map((t) => t.id)).toEqual([2, 3, 1]);
  });
});

describe("undoAction — 모든 변경이 왕복 복원", () => {
  const base = [todo(1), todo(2, { done: true }), todo(3)];

  it("Added를 되돌리면 추가된 항목이 사라짐", () => {
    const added = [...base, todo(4)];
    expect(undoAction(added, Action.Added(4))).toEqual(base);
  });

  it("Removed를 되돌리면 원래 위치로 복원", () => {
    const removed = base.filter((t) => t.id !== 2);
    expect(undoAction(removed, Action.Removed(base[1]!, 1))).toEqual(base);
  });

  it("Toggled를 되돌리면 체크 상태가 반전", () => {
    const toggled = base.map((t) => (t.id === 2 ? { ...t, done: false } : t));
    expect(undoAction(toggled, Action.Toggled(2))).toEqual(base);
  });

  it("Reprioritized를 되돌리면 이전 우선순위로", () => {
    const changed = base.map((t) =>
      t.id === 1 ? { ...t, priority: Priority.High } : t,
    );
    expect(
      undoAction(changed, Action.Reprioritized(1, Priority.Medium)),
    ).toEqual(base);
  });

  it("ClearedDone을 되돌리면 완료 항목이 id 순서로 복귀", () => {
    const cleared = base.filter((t) => !t.done);
    expect(undoAction(cleared, Action.ClearedDone([base[1]!]))).toEqual(base);
  });
});

describe("progressLabel / emptyMessage — 상태 문구", () => {
  it("전부 완료면 축하 문구(가드 arm)", () => {
    expect(progressLabel(Progress.AllDone, 0)).toBe("모두 완료! 🎉");
  });

  it("남은 개수 표시(or-패턴 arm)", () => {
    expect(progressLabel(Progress.SomeDone, 2)).toBe("2개 남음");
    expect(progressLabel(Progress.NoneDone, 3)).toBe("3개 남음");
  });

  it("빈 목록 문구는 (필터 × 진행 상태) 튜플 match", () => {
    expect(emptyMessage(Filter.All, Progress.Empty)).toEqual(
      Option.Some("아직 할 일이 없어요."),
    );
    expect(emptyMessage(Filter.Active, Progress.AllDone)).toEqual(
      Option.Some("진행 중인 일이 없어요. 전부 끝!"),
    );
    expect(emptyMessage(Filter.Completed, Progress.NoneDone)).toEqual(
      Option.Some("아직 완료한 일이 없어요."),
    );
    expect(emptyMessage(Filter.All, Progress.SomeDone)).toEqual(Option.None);
  });
});
