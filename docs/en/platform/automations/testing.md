---
title: Test an automation
description: Write tests for an automation in the editor, run them on your draft or a saved version, and read what a failing test found.
---

A test runs an automation with an input you choose and checks what comes out: the output, the actions it takes and which steps run. Tests are part of the automation's document, so every version keeps its own. Tale runs them when you save and again before every deploy, and a version whose tests fail can't be deployed. Writing and running tests takes the Developer, Admin or Owner role.

## Open the tests

In the [workflow editor](/platform/automations/editor), select **Tests** beside **Problems**. The button counts the results, such as two green ticks and one red cross, and opens the **Tests** tab of the panel under the canvas; **Problems** is the other tab. On a phone, the list opens in a panel of its own.

Each row is one test, in the order the document lists them: its status, its name, and for a test that failed, the first thing that went wrong. The line above the list says where the results come from: **Run on your draft**, or the version's last check, such as **Checked when deploying version 3** with the date. A test reads **Not run yet** until it has a result, **Couldn't run** when the automation itself could not run, and **Changed since this result** once the automation or the test changed after its run; that result still shows, so you can see what changed it.

<Frame caption="Run all on the order discounts: the big order's test fails, and its result says what the output should have been.">

![The editor of Order discounts with Tests showing one tick and one cross in the header and the Tests tab under the canvas: Small order pays full price passed, and Big order gets 10% off failed because 2 fields the test checks are missing or different. Beside the canvas, the failed test's Result tab lists discount: expected 240, got 120 and total: expected 2160, got 2280, and says 1 other field is not checked.](/images/platform/automation-tests.webp)

</Frame>

## Add a test

1. In the **Tests** tab, select **Add test**, and **Blank test** if it opens a menu. A test named **New test** opens beside the canvas, with a placeholder for each field the run input requires.
2. In **Setup**, fill in the test: its **Name**, the **Input** the run receives as JSON, the **Simulated outputs** and **Simulated failures** that stand in for steps, and under **Expectations** what the run must do. Your changes go into the draft as you type.
3. Save the draft to keep the test. Saving runs every test and records the result with the version.

Adding a simulated output starts it empty: `{}` for a node, or `[]` when it runs once per item. **Use the last run's output** copies the output from the run on the canvas when you choose it. Review that value before saving.

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
- `scenarios` gives a step that calls a connector one of the cases its action ships, as [Pick a connector's scenario](#scenarios) describes.

Without `expect`, a test passes when the run succeeds. A row's menu also copies a test with **Duplicate** or removes it with **Delete**; **Discard** brings back a deleted test until you save.

### Pick a connector's scenario {#scenarios}

A connector action can ship scenarios: named cases of what its service answers, such as an empty list, a refused write or a rate limit. `scenarios` maps a step's id to the name of a scenario its action ships, so the test shows what the automation does in that case. In this test, the step `post` calls `slack.send_message` with the channel from the input, and gets the answer Slack gives for a channel that doesn't exist:

```yaml
name: Slack rejects an unknown channel
input:
  channel: C0000000009
scenarios:
  post: channel_not_found
expect:
  failure:
    node: post
```

The step's input is still worked out and checked. A call whose input matches the scenario gets the scenario's answer; any other call gets the connector's usual simulated answer.

- When the scenario answers with an output, it becomes the step's output, and the step carries **Simulated output** as if the test gave that output. A write still records the action it would have taken.
- When the scenario answers with an error, the step fails with the scenario's message, marked as simulated by the test, and carries **Simulated failure**. The run treats it as the same failure from the service, such as a refused access or a rate limit, so the rest of the automation handles it as it would in a live run.
- When none of the step's calls matches the scenario, it shows under **Not used**, as an unused simulated output does.

A step takes one stand-in: a scenario, a simulated output or a simulated failure. The **Setup** form has no control for `scenarios` yet: write them with **Edit as YAML**, and the form keeps them as written. [Connectors](/develop/connectors#scenarios) explains how an action declares its scenarios and how their failures are classified. Over the [MCP endpoint](/develop/mcp-endpoint#authoring), `get_catalog` lists the scenarios each action ships.

### Start from the trigger or a path

When the automation has more to start from, **Add test** opens a menu. **Blank test** adds the test described above. **From the trigger's input** starts with the input the bound trigger hands a run: a schedule firing at a fixed moment, a webhook's sample delivery or an event's example, so the test gets the same input every time it runs. **For an untested path** lists the possible paths no test goes down yet, as the [Paths list](/platform/automations/editor#paths) words them; once every path has one, the menu says **Every path has a test** instead. The new test simulates each failure the path needs and expects each step's state on it; its description says which conditions the input must make true or false. **From a run** saves one of the five newest runs as a test, as [Save a run as a test](#save-a-run) describes.

### Save a run as a test {#save-a-run}

A run that did what it should, or one that went wrong, makes a test of its own. **From a run** in the **Add test** menu lists the five newest runs, a run's page and its row in the **Runs** tab offer **Save as test…** in their menus, and a [try of the draft](/platform/automations/editor#try-the-draft) offers **Save as test** in its strip. The dialog makes the test from the run, with its input:

- **The test expects** follows how the run ended: **It returns this output**, or **Its output includes this**, for a run that succeeded; **It succeeds** for one that failed, so the test fails until the failure is fixed, or **It fails at Score** when it failed at Score. **Nothing yet** only checks that the run succeeds.
- **Simulate with this run's data** lists the steps that called a model, an agent, a connector or another automation, each on by default: in the test it answers as it did in the run. A code step stays off, because your code is what the test checks.
- **Also expect the same actions** expects each action the run took, without its input.

**Add test** puts the test in your draft and opens it on **Setup**; saving the draft keeps it. Values that look like secrets are left out, and the dialog says how many. The run's input and the outputs you keep become part of the automation, so anyone who can open it can read them.

Copied inputs, outputs and failure messages are authored content in the saved version. They can remain in retained versions after the source run is deleted or removed through retention or erasure. Removing a test in a later version does not edit earlier versions. Before saving, review **Input**, **Simulated outputs**, **Simulated failures** and **Expectations**, and replace personal data with synthetic examples.

<Frame caption="A live run of Answer launch questions saved as a test: it expects what the run returned, and the search answers as it did in the run.">

![The Save the run as a test dialog: Name From the run of Oct 11, 2026, 12:29 PM; under The test expects, It returns this output is chosen; under Simulate with this run's data, Related is on and answers with the output it returned in the run; Also expect the same actions is off; then the line on where the test goes and who can read it, with Cancel and Add test.](/images/platform/automation-save-as-test.webp)

</Frame>

### See what the tests cover

Once tests have run, the line above the list says how many of the automation's possible paths they go down, such as **Covers 1 of 2 paths**. Select it to open the Paths list, where each path reads **Tested by** with the tests that go down it, or **Not tested**. A test covers the path its run actually took, which is not always the one it was written for.

<Frame caption="Run all on the order discounts: both tests skip Review, so the path where it runs has no test yet.">

![The editor of Order discounts after Run all, with Possible paths open beside the canvas: Path 1, where Review runs, is Not tested, and Path 2, where Review is skipped, is Tested by Small order pays full price and Big order gets 10% off. Under the canvas, the Tests tab reads Covers 1 of 2 paths.](/images/platform/automation-test-coverage.webp)

</Frame>

## Run the tests

**Run all** runs every test, and **Run** in a row's menu or in the open test runs one. With unsaved changes, the tests run on your draft. Without, they run on the version shown, and a run of all its tests becomes that version's test result, marked **Checked by hand**.

Each version keeps its last check, and [Versions](/platform/automations/editor#versions) shows it, such as **2 of 3 tests passed · checked on deploy**. When failing tests stop a deploy, **Tests** opens with focus on the first test that failed.

Tests always run simulated: a connector, a model or an agent answers with a stand-in, and nothing is sent or changed outside Tale. A test stops after 10 seconds, and a run of all tests after 60 seconds. If many tests ran in your organization just before, Tale asks you to wait a few seconds and says how many.

## Read a result

Select a test to open it beside the canvas. A test with a result opens on **Result**: one sentence for each thing that went wrong, and what explains it.

- **Output**: each field that differs, such as `total: expected 2160, got 2280`, and the fields the test expected but did not get.
- **Actions**: the action the test expected and what happened instead, or the one that should not have happened.
- **Steps**: the step that ran, was skipped or failed against the test's expectation, with a way to show it on the canvas.
- **A failed run**: the step the run failed at and why, in the words of the [execution logs](/platform/automations/execution-logs).

**Simulated** names the steps the test stands in for, each with a simulated output, a simulated failure or a scenario. **Not used** names the steps whose stand-in no call took: a step the run skipped, or one whose scenario none of its calls matched, which got the connector's usual simulated answer instead. **Technical details** shows the engine's own message. A result from the version's last check keeps no steps; run the test to see them.

### Show a test's run on the canvas {#show-on-canvas}

**Show on the canvas**, on **Result** or in a test's row menu, lays the test's latest run over the canvas in place of the last run, to play back step by step like a recorded run. A strip above the canvas names the test, such as **Test: Big order gets 10% off**, and says when it ran and whether it passed: **Passed in 4 ms**, or its first failure. A step the test stands in for carries **Simulated output** or **Simulated failure**. Select a step to see what it received and returned on its **In this test** tab. **Run** in the strip runs the test again and shows the new run, and **Hide result** brings back the last run. Once the automation or the test changes, the strip says so: the run no longer shows what the draft does.

## Fix a problem in a test

Tale checks tests as it checks the rest of the draft. A test that can never pass, for example one that simulates a step the automation doesn't have or names an unknown field, shows in **Problems** with what to fix. So does a test that picks a scenario for a step the automation doesn't have, picks one the step's action doesn't ship, or gives a step two stand-ins. For a scenario the action doesn't ship, the problem names the closest one and lists the scenarios the action ships. Such a test can't run until you fix it. Select the problem to open the test at that place in its YAML.
