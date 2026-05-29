import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StatusBar from "./StatusBar";

describe("StatusBar", () => {
  it("renders without crashing", () => {
    render(<StatusBar />);
    // Just verify something renders
    expect(document.body.textContent).toBeTruthy();
  });
});
