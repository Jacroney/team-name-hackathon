import { expect, test } from "@playwright/test";

test("operator can review incident provenance and open dispatch confirmation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Desktop console workflow");
  await page.goto("/incidents/CM-0722-0017");

  await expect(page.getByText("Crisis Mesh", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Situation summary" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dispatch decision" })).toBeVisible();

  await page.getByRole("button", { name: /People 3/ }).click();
  await expect(page.getByText("SOURCE FOR SELECTED FIELD")).toBeVisible();

  await page.getByRole("button", { name: "Claim incident" }).click();
  await expect(page.getByText(/You now hold the approval lock/)).toBeVisible();
  await page.getByRole("button", { name: "Approve and dispatch" }).click();
  await expect(page.getByRole("dialog")).toContainText("Confirm emergency dispatch");
});

test("mobile uses queue to incident to action drawer", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only navigation test");
  await page.goto("/incidents");

  await expect(page.getByRole("complementary", { name: "Incident queue" })).toBeVisible();
  await page.getByText("CM-0722-0017").click();
  await expect(page.getByRole("button", { name: "Review decision" })).toBeVisible();
  await page.getByRole("button", { name: "Review decision" }).click();
  await expect(page.getByRole("dialog")).toContainText("Extracted fields");
});
