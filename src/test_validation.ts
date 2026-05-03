import { validateCertificate } from "./platforms/validationService";
import { logger } from "./utils/logger";
import "dotenv/config";

async function runTest() {
  const url = "https://www.guvi.in/verify-certificate?id=8P196QR125HG17Lc37";
  const name = "Goutham K";

  console.log(`\n--- Testing Certificate Validation ---`);
  console.log(`URL: ${url}`);
  console.log(`Claimed Name: ${name}\n`);

  try {
    const result = await validateCertificate({
      certificateUrl: url,
      claimedName: name
    });

    console.log("Validation Result:");
    const { screenshotBase64, ...printableResult } = result;
    console.log(JSON.stringify(printableResult, null, 2));

    if (result.isValid) {
      console.log("\n✅ SUCCESS: The certificate belongs to " + result.certificateData.recipientName);
    } else {
      console.log("\n❌ FAILED: " + (result.errorMessage || "Name mismatch"));
    }
  } catch (error) {
    console.error("Error during validation:", error);
  }
}

runTest();
