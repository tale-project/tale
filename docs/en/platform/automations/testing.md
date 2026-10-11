---
title: Test an automation
description: Write tests for an automation in the editor, run them on your draft or a saved version, and read what a failing test found.
---

A test runs an automation with an input you choose and checks what comes out: the output, the actions it takes and which steps run. Tests are part of the automation's document, so every version keeps its own. Tale runs them when you save and again before every deploy, and a version whose tests fail can't be deployed. Writing and running tests takes the Developer, Admin or Owner role.

## Open the tests

In the [workflow editor](/platform/automations/editor), select **Tests** beside **Problems**. The button counts the results, such as two green ticks and one red cross, and opens the **Tests** tab of the panel under the canvas; **Problems** is the other tab. On a phone, the list opens in a panel of its own.

Each row is one test, in the order the document lists them: its status, its name, and for a test that failed, the first thing that went wrong. The line above the list says where the results come from: **Run on your draft**, or the version's last check, such as **Checked when version 3 was deployed** with the date. A test reads **Not run yet** until it has a result, **Couldn't run** when the automation itself could not run, and **Changed since this result** once the automation or the test changed after its run; that result still shows, so you can see what changed it.

<Frame caption="Run all on the order discounts: the big order's test fails, and its result says what the output should have been.">

![The editor of Order discounts with Tests showing one tick and one cross in the header and the Tests tab under the canvas: Small order pays full price passed, and Big order gets 10% off failed because 2 fields the test checks are missing or different. Beside the canvas, the failed test's Result tab lists discount: expected 240, got 120 and total: expected 2160, got 2280, and says 1 other field is not checked.](/images/platform/automation-tests.webp)

</Frame>

## Add a test

1. In the **Tests** tab, select **Add test**. A test named **New test** opens beside the canvas, with a placeholder for each field the run input requires.
2. In **Setup**, fill in the test: its **Name**, the **Input** the run receives as JSON, the **Simulated outputs** and **Simulated failures** that stand in for steps, and under **Expectations** what the run must do. Your changes go into the draft as you type.
3. Save the draft to keep the test. Saving runs every test and records the result with the version.

<Frame caption="A test's Setup: the run's input as JSON, the steps it simulates, and what it expects of the run.">

![The Setup tab of the test Big order gets 10% off beside the canvas of Order discounts: Name, an empty Description, an Input with quantity 120 and unitPrice 20, Simulated outputs and Simulated failures with a picker each, and Expectations, where the output is checked with Includes.](/images/platform/automation-test-setup.webp)

</Frame>

**Edit as YAML** shows the same test as text, for a part the form has no control for; while the text doesn't parse, the test keeps its last version that did. In YAML, a test has a `name`, the `input` the run receives, and `expect`, what the run must do:

```yaml
name: Big order gets 10% off
input:
  quantity: 120
  unitPrice: 20
expect:
  outputIncludes:
    discount: 240
    total: 2160
```

- `output` must equal the run's output exactly; `outputIncludes` checks only the fields it lists, and the output may hold more.
- `nodes` names steps and what must happen to each: `ran`, `skipped`, or `failed` when the run goes on past the failure.
- `effects` lists actions the run must take, such as an email to send, by node type; with `absent: true`, an action that must not happen.
- `failure` says the run must fail, optionally at a given step and with a message that contains the given text.
- `mocks` gives a step an output to use instead of calling its service or model, and `failures` makes a step fail with the given message.

Without `expect`, a test passes when the run succeeds. A row's menu also copies a test with **Duplicate** or removes it with **Delete**; **Discard** brings back a deleted test until you save.

## Run the tests

**Run all** runs every test, and **Run** in a row's menu or in the open test runs one. With unsaved changes, the tests run on your draft. Without, they run on the version shown, and a run of all its tests becomes that version's test result, marked **Checked by hand**.

Tests always run simulated: a connector, a model or an agent answers with a stand-in, and nothing is sent or changed outside Tale. A test stops after 10 seconds, and a run of all tests after 60 seconds. If many tests ran in your organization just before, Tale asks you to wait a few seconds and says how many.

## Read a result

Select a test to open it beside the canvas. A test with a result opens on **Result**: one sentence for each thing that went wrong, and what explains it.

- **Output**: each field that differs, such as `total: expected 2160, got 2280`, and the fields the test expected but did not get.
- **Actions**: the action the test expected and what happened instead, or the one that should not have happened.
- **Steps**: the step that ran, was skipped or failed against the test's expectation, with a way to show it on the canvas.
- **A failed run**: the step the run failed at and why, in the words of the [execution logs](/platform/automations/execution-logs).

**Simulated** names the steps the test stands in for, and **Not used** the ones the run skipped. **Technical details** shows the engine's own message. A result from the version's last check keeps no steps; run the test to see them.

## Fix a problem in a test

Tale checks tests as it checks the rest of the draft. A test that can never pass, for example one that simulates a step the automation doesn't have or names an unknown field, shows in **Problems** with what to fix. Select the problem to open the test at that place in its YAML.
