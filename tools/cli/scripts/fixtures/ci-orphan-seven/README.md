# Retained cancelled merge-group graphs

Workflow/action/script files are exact public Git blobs, stored as `.txt` to keep
them inert. Checks, CLI, E2E, Build and Commitlint come from
`000c0e99173b469cbc7e40b2e9cff5671a25974e`; SAST from
`f472b321feddb0c9f6e2478744a82c06b9ec2eee`; Security from
`76f2cf8da13e0038d91afd40d4bb786fb3e006bc`. The common action and script
are byte-identical at all three sources. `build-current.yml.txt` is from
`f58eed21d50827e3d9aa9f185409a771e3dbb780`; it adds image compression
settings without changing the graph. The older Checks fixture remains separate.

`jobs.json` retains only the observed job names, statuses, conclusions and runner
assignment from one complete cancelled graph per workflow. Tests generate synthetic
run/job identities. These samples establish graph behavior, not authorization to
cancel a live run. Current-source drift is tested against the actual repository
files; fixtures are never silently regenerated from current main.
