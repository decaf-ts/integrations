import {
  KibanaIndexBuilder,
  KibanaIndexBuilderCollection,
} from "../../../src/kibana/builders";
import {
  KibanaIndexMatchMode,
} from "../../../src/kibana/types";
import { logParameterRegistry } from "@decaf-ts/logging";

describe("KibanaIndexBuilder", () => {
  // ── EXACT mode ──
  describe("EXACT match mode", () => {
    it("produces a correct title for a single index name", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index-2024")
        .setId("my-index-dv")
        .setName("My Index")
        .build();

      expect(dv.title).toBe("my-index-2024");
      expect(dv.id).toBe("my-index-dv");
      expect(dv.name).toBe("My Index");
    });

    it("throws when exactIndexName is missing", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();
    });

    it("throws when exactIndexName contains a wildcard", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index-*")
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();
    });
  });

  // ── PREFIX mode ──
  describe("PREFIX match mode", () => {
    it("produces a prefix-* title", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat-pla-demo")
        .setId("filebeat-dv")
        .setName("Filebeat")
        .build();

      expect(dv.title).toBe("filebeat-pla-demo-*");
    });

    it("does not duplicate the separator when prefix already ends with it", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat-pla-demo-")
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat-pla-demo-*");
    });

    it("supports a custom separator", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat.pla.demo")
        .setSeparator(".")
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat.pla.demo.*");
    });

    it("throws when prefix is missing", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();
    });
  });

  // ── LOGGER_GENERATED mode ──
  describe("LOGGER_GENERATED match mode", () => {
    it("renders log pattern keys into the index title", () => {
      logParameterRegistry.register({
        key: "testOrg",
        render: (payload) => payload.app,
      });
      logParameterRegistry.register({
        key: "testEnv",
        render: (payload) =>
          payload.context && payload.context.length > 0
            ? payload.context[0]
            : undefined,
      });

      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setPrefix("filebeat")
        .setLogPattern("{testOrg}-{testEnv}")
        .setLogPayload({
          app: "pla",
          context: ["demo"],
        })
        .setId("generated-dv")
        .setName("Generated")
        .build();

      expect(dv.title).toBe("filebeat-pla-demo-*");

      logParameterRegistry.unregister("testOrg");
      logParameterRegistry.unregister("testEnv");
    });

    it("throws when neither logPattern nor prefix is set", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setLogPayload({ app: "pla" })
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();
    });

    it("throws when logPayload is missing but logPattern is set", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setLogPattern("{app}")
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();
    });

    it("throws when no segments are rendered from the pattern", () => {
      logParameterRegistry.register({
        key: "testEmpty",
        render: () => undefined,
      });

      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setLogPattern("{testEmpty}")
        .setLogPayload({})
        .setId("dv")
        .setName("DV");

      expect(() => builder.build()).toThrow();

      logParameterRegistry.unregister("testEmpty");
    });

    it("works without a prefix using built-in app parameter", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setLogPattern("{app}")
        .setLogPayload({ app: "myapp" })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("myapp-*");
    });

    it("respects shouldInclude when rendering log parameters", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setPrefix("filebeat")
        .setLogPattern("{app}-{context}")
        .setLogPayload({
          app: "",
          context: ["demo"],
        })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat-demo-*");
    });

    it("uses built-in context parameter with dot separator", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.LOGGER_GENERATED)
        .setPrefix("filebeat")
        .setLogPattern("{app}-{context}")
        .setLogPayload({
          app: "pla",
          context: ["demo", "sub"],
        })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat-pla-demo.sub-*");
    });
  });

  // ── Compounding: EXACT + logger-generated ──
  describe("compounding EXACT with logger-generated segments", () => {
    it("appends rendered segments to an exact index name", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index")
        .setLogPattern("{app}")
        .setLogPayload({ app: "pla" })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("my-index-pla-*");
    });

    it("appends multiple rendered segments to an exact index name", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index")
        .setLogPattern("{app}-{context}")
        .setLogPayload({
          app: "pla",
          context: ["demo"],
        })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("my-index-pla-demo-*");
    });
  });

  // ── Compounding: PREFIX + logger-generated ──
  describe("compounding PREFIX with logger-generated segments", () => {
    it("appends rendered segments to a prefix", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setLogPattern("{app}-{context}")
        .setLogPayload({
          app: "pla",
          context: ["demo"],
        })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat-pla-demo-*");
    });

    it("uses custom separator for compounded segments", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setSeparator(".")
        .setLogPattern("{app}")
        .setLogPayload({ app: "pla" })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat.pla.*");
    });

    it("omits compounded segments when shouldInclude is false for all", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setLogPattern("{app}")
        .setLogPayload({ app: "" })
        .setId("dv")
        .setName("DV")
        .build();

      expect(dv.title).toBe("filebeat-*");
    });
  });

  // ── Validation ──
  describe("validation", () => {
    it("throws ValidationError when id is missing", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setName("Name");

      expect(() => builder.build()).toThrow();
    });

    it("throws ValidationError when name is missing", () => {
      const builder = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setId("id");

      expect(() => builder.build()).toThrow();
    });
  });

  // ── All KibanaDataViewConfig fields ──
  describe("data view fields", () => {
    it("passes through all optional fields", () => {
      const dv = new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index")
        .setId("dv-id")
        .setName("DV Name")
        .setTimeFieldName("@timestamp")
        .setNamespaces(["space1", "space2"])
        .setSourceFilters([{ value: "field1" }])
        .setRuntimeFieldMap({ field: { type: "keyword" } })
        .setFieldAttrs({ field: { customLabel: "Field" } })
        .setAllowNoIndex(true)
        .build();

      expect(dv.timeFieldName).toBe("@timestamp");
      expect(dv.namespaces).toEqual(["space1", "space2"]);
      expect(dv.sourceFilters).toEqual([{ value: "field1" }]);
      expect(dv.runtimeFieldMap).toEqual({ field: { type: "keyword" } });
      expect(dv.fieldAttrs).toEqual({
        field: { customLabel: "Field" },
      });
      expect(dv.allowNoIndex).toBe(true);
    });
  });
});

describe("KibanaIndexBuilderCollection", () => {
  it("builds multiple data views via for()", () => {
    const collection = KibanaIndexBuilderCollection.for(
      new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setId("dv1")
        .setName("DV1"),
      new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("metricbeat")
        .setId("dv2")
        .setName("DV2"),
    );

    const result = collection.build();
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("filebeat-*");
    expect(result[1]?.title).toBe("metricbeat-*");
  });

  it("supports add() method", () => {
    const collection = new KibanaIndexBuilderCollection().add(
      new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("exact-index")
        .setId("dv1")
        .setName("DV1"),
    );

    const result = collection.build();
    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("exact-index");
  });

  it("builds an empty collection", () => {
    const collection = new KibanaIndexBuilderCollection();
    const result = collection.build();
    expect(result).toHaveLength(0);
  });

  it("builds a collection with compounded builders", () => {
    const collection = KibanaIndexBuilderCollection.for(
      new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.PREFIX)
        .setPrefix("filebeat")
        .setLogPattern("{app}-{context}")
        .setLogPayload({ app: "pla", context: ["demo"] })
        .setId("dv1")
        .setName("DV1"),
      new KibanaIndexBuilder()
        .setMatchMode(KibanaIndexMatchMode.EXACT)
        .setExactIndexName("my-index")
        .setId("dv2")
        .setName("DV2"),
    );

    const result = collection.build();
    expect(result).toHaveLength(2);
    expect(result[0]?.title).toBe("filebeat-pla-demo-*");
    expect(result[1]?.title).toBe("my-index");
  });
});
