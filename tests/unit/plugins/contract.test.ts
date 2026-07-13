import {
  EMBED_MESSAGE_TYPE,
  createSwitchDashboardMessage,
  sendSwitchDashboardMessage,
  isSwitchDashboardMessage,
  isEmbedParentMessage,
  type EmbedMessageTarget,
  type SwitchDashboardPayload,
} from "../../../src/plugins/contract";

describe("plugins/contract", () => {
  describe("EMBED_MESSAGE_TYPE", () => {
    it("exposes all four message type constants", () => {
      expect(EMBED_MESSAGE_TYPE.SWITCH).toBe("ORG_DASHBOARD_EMBED_SWITCH_DASHBOARD");
      expect(EMBED_MESSAGE_TYPE.READY).toBe("ORG_DASHBOARD_EMBED_READY");
      expect(EMBED_MESSAGE_TYPE.RENDERED).toBe("ORG_DASHBOARD_EMBED_RENDERED");
      expect(EMBED_MESSAGE_TYPE.ERROR).toBe("ORG_DASHBOARD_EMBED_ERROR");
    });
  });

  describe("createSwitchDashboardMessage", () => {
    it("creates a switch message with the correct type", () => {
      const payload: SwitchDashboardPayload = {
        dashboardId: "abc-123",
        timeRange: { from: "now-15d", to: "now" },
        query: { language: "kuery", query: "" },
        guestToken: "tok-xyz",
      };
      const msg = createSwitchDashboardMessage(payload);
      expect(msg.type).toBe(EMBED_MESSAGE_TYPE.SWITCH);
      expect(msg.dashboardId).toBe("abc-123");
      expect(msg.timeRange).toEqual({ from: "now-15d", to: "now" });
      expect(msg.query).toEqual({ language: "kuery", query: "" });
      expect(msg.guestToken).toBe("tok-xyz");
    });

    it("creates a switch message without optional fields", () => {
      const msg = createSwitchDashboardMessage({ dashboardId: "d1" });
      expect(msg.type).toBe(EMBED_MESSAGE_TYPE.SWITCH);
      expect(msg.dashboardId).toBe("d1");
      expect(msg.timeRange).toBeUndefined();
      expect(msg.query).toBeUndefined();
      expect(msg.filters).toBeUndefined();
      expect(msg.guestToken).toBeUndefined();
    });
  });

  describe("isSwitchDashboardMessage", () => {
    it("validates a correct switch message", () => {
      expect(isSwitchDashboardMessage({ type: EMBED_MESSAGE_TYPE.SWITCH, dashboardId: "d1" })).toBe(true);
    });

    it("rejects non-objects", () => {
      expect(isSwitchDashboardMessage(null)).toBe(false);
      expect(isSwitchDashboardMessage("hello")).toBe(false);
      expect(isSwitchDashboardMessage(42)).toBe(false);
    });

    it("rejects wrong type", () => {
      expect(isSwitchDashboardMessage({ type: EMBED_MESSAGE_TYPE.READY, dashboardId: "d1" })).toBe(false);
    });

    it("rejects empty dashboardId", () => {
      expect(isSwitchDashboardMessage({ type: EMBED_MESSAGE_TYPE.SWITCH, dashboardId: "" })).toBe(false);
    });
  });

  describe("isEmbedParentMessage", () => {
    it("validates ready, rendered, and error messages", () => {
      expect(isEmbedParentMessage({ type: EMBED_MESSAGE_TYPE.READY, dashboardId: null })).toBe(true);
      expect(isEmbedParentMessage({ type: EMBED_MESSAGE_TYPE.RENDERED, dashboardId: "d1" })).toBe(true);
      expect(isEmbedParentMessage({ type: EMBED_MESSAGE_TYPE.ERROR, dashboardId: null, message: "fail" })).toBe(true);
    });

    it("rejects switch messages and non-objects", () => {
      expect(isEmbedParentMessage({ type: EMBED_MESSAGE_TYPE.SWITCH, dashboardId: "d1" })).toBe(false);
      expect(isEmbedParentMessage(null)).toBe(false);
    });
  });

  describe("sendSwitchDashboardMessage", () => {
    it("uses postMessage when available (Kibana path)", () => {
      const posted: unknown[] = [];
      const target: EmbedMessageTarget = {
        postMessage: (msg: unknown) => {
          posted.push(msg);
        },
      };
      sendSwitchDashboardMessage(target, { dashboardId: "d1" }, "https://kibana.host");
      expect(posted).toHaveLength(1);
      expect((posted[0] as { type: string }).type).toBe(EMBED_MESSAGE_TYPE.SWITCH);
    });

    it("uses switchDashboard when available (Superset path)", async () => {
      const switched: string[] = [];
      const target: EmbedMessageTarget = {
        switchDashboard: async (dashboardId: string) => {
          switched.push(dashboardId);
          return { dashboardId, accepted: true as const };
        },
      };
      sendSwitchDashboardMessage(target, { dashboardId: "d2", guestToken: "tok" }, "https://superset.host");
      expect(switched).toEqual(["d2"]);
    });

    it("throws when neither method is available", () => {
      const target: EmbedMessageTarget = {};
      expect(() => sendSwitchDashboardMessage(target, { dashboardId: "d3" }, "https://host")).toThrow();
    });
  });
});
