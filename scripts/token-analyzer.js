const axios = require("axios");

// Facebook Access Tokens to analyze
const tokens = [
  {
    name: "Token 1",
    token:
      "EAAOmhuvUrakBPISCKTmxK0l77xYpQZCkOBfF4FrOb1a1xV8bZAJNabDC9gPiHaZCOCuyUmcZCDjsKACYvQ61T37JaSrVUA3M9YYV02qFcjHHl5JyQyphyHmDy0AjZBRrh2o7p0ApPuylrAZBRYqw8Jx7OZBF4y48xSMMmC5lkIZBdIDbzMBmhZCNDnesGOQwYPIw3UgZDZD",
  },
  {
    name: "Token 2",
    token:
      "EAAOmhuvUrakBPWdGJHpTrllF2fZB7g1Imdv80dgjFyYmehO9xihZASH10zRzPJpCaOnuf5v61SwWgnLvdZCNytgq6fcS1vNZCNJHjoORFWKr60mTv32ZAoShptO3ZCoCizN0TZAin5J1bc43zkGdHCJ6ZBh7iR7gZAsOc63faZCNpiErscQidO2W0ZAR6nBwD3cqn5arON17RWt637Dl0gHtYkKVJMb0TO32JWXsFATSQZDZD",
  },
];

async function analyzeToken(tokenData) {
  console.log(`\n=== Analyzing ${tokenData.name} ===`);
  console.log(`Token: ${tokenData.token.substring(0, 20)}...`);

  try {
    // 1. Get basic token info
    const debugResponse = await axios.get(
      `https://graph.facebook.com/debug_token`,
      {
        params: {
          input_token: tokenData.token,
          access_token: tokenData.token,
        },
      }
    );

    const tokenInfo = debugResponse.data.data;
    console.log("\n📊 Token Information:");
    console.log(`- App ID: ${tokenInfo.app_id}`);
    console.log(`- Type: ${tokenInfo.type}`);
    console.log(`- Valid: ${tokenInfo.is_valid}`);
    console.log(`- User ID: ${tokenInfo.user_id || "N/A"}`);
    console.log(
      `- Expires: ${
        tokenInfo.expires_at
          ? new Date(tokenInfo.expires_at * 1000).toISOString()
          : "Never"
      }`
    );
    console.log(
      `- Issued: ${
        tokenInfo.issued_at
          ? new Date(tokenInfo.issued_at * 1000).toISOString()
          : "N/A"
      }`
    );

    // 2. Get scopes/permissions
    if (tokenInfo.scopes && tokenInfo.scopes.length > 0) {
      console.log("\n🔐 Permissions/Scopes:");
      tokenInfo.scopes.forEach((scope) => {
        console.log(`- ${scope}`);
      });
    }

    // 3. Try to get user info (if it's a user token)
    if (tokenInfo.type === "USER" && tokenInfo.user_id) {
      try {
        const userResponse = await axios.get(`https://graph.facebook.com/me`, {
          params: {
            access_token: tokenData.token,
            fields: "id,name,email",
          },
        });
        console.log("\n👤 User Information:");
        console.log(`- ID: ${userResponse.data.id}`);
        console.log(`- Name: ${userResponse.data.name || "N/A"}`);
        console.log(`- Email: ${userResponse.data.email || "N/A"}`);
      } catch (userError) {
        console.log(
          "\n👤 User Information: Unable to fetch (insufficient permissions)"
        );
      }
    }

    // 4. Try to get pages (if token has pages permissions)
    try {
      const pagesResponse = await axios.get(
        `https://graph.facebook.com/me/accounts`,
        {
          params: {
            access_token: tokenData.token,
          },
        }
      );

      if (pagesResponse.data.data && pagesResponse.data.data.length > 0) {
        console.log("\n📄 Accessible Pages:");
        pagesResponse.data.data.forEach((page) => {
          console.log(`- ${page.name} (ID: ${page.id})`);
          console.log(`  Tasks: ${page.tasks ? page.tasks.join(", ") : "N/A"}`);
        });
      }
    } catch (pagesError) {
      console.log("\n📄 Pages: No access or insufficient permissions");
    }

    // 5. Try to get business accounts (if token has business permissions)
    try {
      const businessResponse = await axios.get(
        `https://graph.facebook.com/me/businesses`,
        {
          params: {
            access_token: tokenData.token,
          },
        }
      );

      if (businessResponse.data.data && businessResponse.data.data.length > 0) {
        console.log("\n🏢 Business Accounts:");
        businessResponse.data.data.forEach((business) => {
          console.log(`- ${business.name} (ID: ${business.id})`);
        });
      }
    } catch (businessError) {
      console.log(
        "\n🏢 Business Accounts: No access or insufficient permissions"
      );
    }

    // 6. Try to get Instagram accounts (if token has Instagram permissions)
    try {
      const igResponse = await axios.get(
        `https://graph.facebook.com/me/accounts`,
        {
          params: {
            access_token: tokenData.token,
            fields: "instagram_business_account",
          },
        }
      );

      const igAccounts = igResponse.data.data
        .filter((page) => page.instagram_business_account)
        .map((page) => page.instagram_business_account);

      if (igAccounts.length > 0) {
        console.log("\n📸 Instagram Business Accounts:");
        igAccounts.forEach((ig) => {
          console.log(`- Instagram Account ID: ${ig.id}`);
        });
      }
    } catch (igError) {
      console.log(
        "\n📸 Instagram Accounts: No access or insufficient permissions"
      );
    }

    return tokenInfo;
  } catch (error) {
    console.log(`\n❌ Error analyzing ${tokenData.name}:`);
    console.log(`- Status: ${error.response?.status || "Unknown"}`);
    console.log(
      `- Message: ${error.response?.data?.error?.message || error.message}`
    );
    console.log(`- Type: ${error.response?.data?.error?.type || "Unknown"}`);

    return null;
  }
}

async function compareTokens() {
  console.log("🔍 Facebook Access Token Analysis & Comparison");
  console.log("=".repeat(60));

  const results = [];

  // Analyze each token
  for (const token of tokens) {
    const result = await analyzeToken(token);
    results.push({ name: token.name, data: result });

    // Add delay between requests to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  // Compare tokens
  console.log("\n\n🔄 TOKEN COMPARISON SUMMARY");
  console.log("=".repeat(60));

  const validTokens = results.filter((r) => r.data && r.data.is_valid);

  if (validTokens.length === 0) {
    console.log("❌ No valid tokens found");
    return;
  }

  console.log("\n📊 Comparison Table:");
  console.log(
    "Property".padEnd(20) + validTokens.map((t) => t.name.padEnd(15)).join("")
  );
  console.log("-".repeat(20 + validTokens.length * 15));

  const properties = ["app_id", "type", "user_id", "expires_at"];

  properties.forEach((prop) => {
    let row = prop.padEnd(20);
    validTokens.forEach((token) => {
      const value = token.data[prop] || "N/A";
      const displayValue =
        prop === "expires_at" && value !== "N/A"
          ? new Date(value * 1000).toLocaleDateString()
          : String(value);
      row += displayValue.substring(0, 14).padEnd(15);
    });
    console.log(row);
  });

  // Compare scopes
  console.log("\n🔐 Permissions Comparison:");
  const allScopes = new Set();
  validTokens.forEach((token) => {
    if (token.data.scopes) {
      token.data.scopes.forEach((scope) => allScopes.add(scope));
    }
  });

  if (allScopes.size > 0) {
    console.log(
      "Permission".padEnd(30) +
        validTokens.map((t) => t.name.padEnd(15)).join("")
    );
    console.log("-".repeat(30 + validTokens.length * 15));

    Array.from(allScopes)
      .sort()
      .forEach((scope) => {
        let row = scope.padEnd(30);
        validTokens.forEach((token) => {
          const hasScope =
            token.data.scopes && token.data.scopes.includes(scope);
          row += (hasScope ? "✅" : "❌").padEnd(15);
        });
        console.log(row);
      });
  }

  console.log("\n✅ Analysis complete!");
}

// Add error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error.message);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the analysis
compareTokens().catch(console.error);
