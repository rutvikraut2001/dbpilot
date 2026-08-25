import { describe, it, expect } from "vitest";
import { parseMongoQuery, parseArgs } from "@/lib/mongo-query";

/**
 * The MongoDB query parser.
 *
 * The regression that prompted this suite: the query editor sends its buffer
 * verbatim, a buffer ends in a newline, and the anchored patterns rejected
 * `db.users.find({})` — the exact syntax the error message recommends — for one
 * invisible trailing character. Every "shape that should be accepted" case
 * below is there because rejecting it produces a user staring at a correct
 * statement being called invalid.
 */

describe("parseMongoQuery", () => {
  describe("the documented form", () => {
    it("parses a find with an empty filter", () => {
      expect(parseMongoQuery("db.users.find({})")).toEqual({
        collectionName: "users",
        operation: "find",
        args: [{}],
      });
    });

    it("parses a call with no arguments", () => {
      expect(parseMongoQuery("db.users.find()")).toEqual({
        collectionName: "users",
        operation: "find",
        args: [],
      });
    });

    it("parses a filter", () => {
      expect(parseMongoQuery('db.users.find({ "age": 30 })')).toEqual({
        collectionName: "users",
        operation: "find",
        args: [{ age: 30 }],
      });
    });

    it("parses a filter and a projection", () => {
      const parsed = parseMongoQuery(
        'db.users.find({ "age": 30 }, { "name": 1 })'
      );

      expect(parsed?.args).toEqual([{ age: 30 }, { name: 1 }]);
    });

    it("parses an aggregation pipeline", () => {
      const parsed = parseMongoQuery(
        'db.orders.aggregate([{ "$match": { "status": "paid" } }])'
      );

      expect(parsed).toEqual({
        collectionName: "orders",
        operation: "aggregate",
        args: [[{ $match: { status: "paid" } }]],
      });
    });

    it("accepts a collection name with underscores and digits", () => {
      expect(parseMongoQuery("db.user_events_2024.find({})")?.collectionName).toBe(
        "user_events_2024"
      );
    });
  });

  describe("whitespace", () => {
    // This is the reported bug. The editor sends what is in the buffer, and a
    // buffer ends in a newline.
    it("accepts a trailing newline", () => {
      expect(parseMongoQuery("db.users.find({})\n")).toEqual({
        collectionName: "users",
        operation: "find",
        args: [{}],
      });
    });

    it("accepts surrounding whitespace", () => {
      // Selecting a line in an editor routinely picks up indentation, which
      // made "Run selection" fail on statements that were already correct.
      expect(parseMongoQuery("   db.users.find({})   ")?.collectionName).toBe(
        "users"
      );
    });

    it("accepts a statement spread over several lines", () => {
      const parsed = parseMongoQuery(`db.users.find({
        "age": 30
      })`);

      expect(parsed?.args).toEqual([{ age: 30 }]);
    });
  });

  describe("semicolons", () => {
    it("accepts a trailing semicolon", () => {
      // Muscle memory from SQL, and mongosh accepts it.
      expect(parseMongoQuery("db.users.find({});")?.collectionName).toBe("users");
    });

    it("accepts a semicolon followed by a newline", () => {
      expect(parseMongoQuery("db.users.find({});\n")?.operation).toBe("find");
    });
  });

  describe("collection accessors", () => {
    it("accepts db.getCollection('name'), which MongoDB's own docs use", () => {
      expect(parseMongoQuery("db.getCollection('users').find({})")).toEqual({
        collectionName: "users",
        operation: "find",
        args: [{}],
      });
    });

    it("accepts db.collection('name'), the Node driver's API", () => {
      // What someone pastes from application code.
      expect(parseMongoQuery("db.collection('users').find({})")).toEqual({
        collectionName: "users",
        operation: "find",
        args: [{}],
      });
    });

    it("accepts double quotes around the name", () => {
      expect(
        parseMongoQuery('db.collection("users").find({})')?.collectionName
      ).toBe("users");
    });

    it("accepts a name that is not a valid identifier", () => {
      // The reason the accessor form exists at all.
      expect(
        parseMongoQuery("db.getCollection('my-events.2024').find({})")
          ?.collectionName
      ).toBe("my-events.2024");
    });

    it("carries the trailing semicolon and newline tolerance", () => {
      expect(
        parseMongoQuery("db.collection('users').find({});\n")?.collectionName
      ).toBe("users");
    });
  });

  describe("messages that name the actual problem", () => {
    it("rejects two statements with a message about statements", () => {
      // Previously the greedy argument capture swallowed everything between the
      // first ( and the last ), then failed complaining about the arguments.
      expect(() =>
        parseMongoQuery("db.users.find()\n\ndb.posts.find()")
      ).toThrow(/one statement can be run at a time/i);
    });

    it("rejects two statements separated by a semicolon", () => {
      expect(() =>
        parseMongoQuery("db.users.find(); db.posts.find()")
      ).toThrow(/one statement can be run at a time/i);
    });

    it("explains that arguments must be JSON when keys are unquoted", () => {
      // mongosh accepts { age: 30 }; JSON.parse does not. Reporting this as an
      // invalid query format sends the user hunting for the wrong mistake.
      expect(() => parseMongoQuery("db.users.find({age: 30})")).toThrow(
        /valid JSON/i
      );
    });

    it("names the operation in the argument error", () => {
      expect(() => parseMongoQuery("db.users.countDocuments({age: 30})")).toThrow(
        /countDocuments\(\)/
      );
    });
  });

  describe("input that is not a statement", () => {
    it.each([
      ["empty", ""],
      ["whitespace only", "   \n  "],
      ["plain SQL", "SELECT * FROM users"],
      ["missing the operation", "db.users"],
      ["missing the call parentheses", "db.users.find"],
      ["not starting at db", "users.find({})"],
    ])("returns null for %s", (_label, query) => {
      expect(parseMongoQuery(query)).toBeNull();
    });
  });
});

describe("parseArgs", () => {
  it("splits arguments on top-level commas", () => {
    expect(parseArgs('{ "a": 1 }, { "b": 2 }')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("does not split on commas nested inside an object", () => {
    expect(parseArgs('{ "a": 1, "b": 2 }')).toEqual([{ a: 1, b: 2 }]);
  });

  it("does not split on a comma inside a string", () => {
    expect(parseArgs('{ "name": "Smith, John" }')).toEqual([
      { name: "Smith, John" },
    ]);
  });

  it("does not let a brace inside a string close the object early", () => {
    // Counting braces without tracking strings ends the object at the "}"
    // inside the value, and the split then lands mid-argument.
    expect(parseArgs('{ "pattern": "}" }, { "b": 2 }')).toEqual([
      { pattern: "}" },
      { b: 2 },
    ]);
  });

  it("handles an escaped quote inside a string", () => {
    expect(parseArgs('{ "quote": "say \\"hi\\"" }')).toEqual([
      { quote: 'say "hi"' },
    ]);
  });

  it("handles a nested array of objects", () => {
    expect(parseArgs('[{ "$match": { "a": 1 } }, { "$limit": 5 }]')).toEqual([
      [{ $match: { a: 1 } }, { $limit: 5 }],
    ]);
  });

  it("throws on malformed JSON so the caller can explain why", () => {
    expect(() => parseArgs("{ a: 1 }")).toThrow();
  });
});
