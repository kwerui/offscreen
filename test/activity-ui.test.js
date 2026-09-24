import assert from "node:assert/strict";
import test from "node:test";

function createElement() {
  return {
    children: [],
    className: "",
    textContent: "",
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
      for (const child of children) child.parentNode = this;
    },
    setAttribute() {},
  };
}

test("renders only the five latest activity receipts using text content", async () => {
  const originalDocument = globalThis.document;

  try {
    const elements = new Map();
    globalThis.document = {
      createElement,
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
    };

    const { setActivityReceipts } = await import(`../public/ui.js?activity-ui-test=${Date.now()}`);

    setActivityReceipts([
      { sequence: 1, status: "success", summary: "one" },
      { sequence: 2, status: "success", summary: "two" },
      { sequence: 3, status: "success", summary: "three" },
      { sequence: 4, status: "failure", summary: "four" },
      { sequence: 5, status: "running", summary: "five" },
      { sequence: 6, status: "success", summary: "<img src=x onerror=alert(1)>" },
    ]);

    const list = elements.get("activity-list");
    const count = elements.get("activity-count");

    assert.equal(count.textContent, "5 actions");
    assert.equal(list.children.length, 5);
    assert.equal(list.children[0].className, "activity-item success");
    assert.equal(list.children[0].children[1].children[0].textContent, "<img src=x onerror=alert(1)>");
    assert.equal(list.children[0].children[1].children[1].textContent, "#6 · success");
    assert.equal(list.children.at(-1).children[1].children[0].textContent, "two");

    setActivityReceipts([]);
    assert.equal(count.textContent, "0 actions");
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].className, "activity-empty");
    assert.equal(list.children[0].textContent, "No actions yet in this session.");
  } finally {
    globalThis.document = originalDocument;
  }
});
