import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type FunctionComponent } from "react";
import * as Option from "@tt/std/option";

import { LevelBadge, MaybeCount, Shout, StatusLine } from "./labx.ttx";

const html = <P extends object>(
  component: FunctionComponent<P>,
  props: P,
): string => renderToStaticMarkup(createElement(component, props));

describe("JSX × tt 조합 (실제 마크업 검증)", () => {
  it("첫 자식 match + 뒤 형제 — 형제가 통째로 살아 있어야 함", () => {
    expect(html(StatusLine, { status: Option.Some("정상") })).toBe(
      '<div class="status"><em>정상</em><span>· 갱신됨</span></div>',
    );
    expect(html(StatusLine, { status: Option.None })).toBe(
      '<div class="status"><em>대기</em><span>· 갱신됨</span></div>',
    );
  });

  it("속성 컨테이너 안 match (리터럴 or-패턴 포함)", () => {
    expect(html(LevelBadge, { level: 0 })).toBe('<span class="quiet">L0</span>');
    expect(html(LevelBadge, { level: 2 })).toBe('<span class="warm">L2</span>');
    expect(html(LevelBadge, { level: 7 })).toBe('<span class="hot">L7</span>');
  });

  it("파이프라인은 본문 계산 후 보간 (이슈 #10 우회)", () => {
    expect(html(Shout, { raw: "  안녕 tt  " })).toBe("<p>안녕 TT!</p>");
  });

  it("컴포넌트 본문의 if let + 조기 return", () => {
    expect(html(MaybeCount, { count: Option.Some(3) })).toBe("<b>3개</b>");
    expect(html(MaybeCount, { count: Option.None })).toBe("<i>비어 있음</i>");
  });
});
