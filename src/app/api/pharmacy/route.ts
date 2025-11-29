import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let payload: { pharmacyName?: string; address?: string; city?: string };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  let { pharmacyName, address, city } = payload;

  // If only one field is provided, try to parse it intelligently
  if (!pharmacyName && !address && !city) {
    return NextResponse.json(
      { error: "Please provide pharmacy name, address, or city." },
      { status: 400 },
    );
  }

  // If pharmacyName contains a comma, it might be the full input
  // Try to parse it: "Shoppers 1221 Lynn Valley Rd, North Van, BC"
  if (pharmacyName && !address && !city && pharmacyName.includes(",")) {
    const parts = pharmacyName.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      pharmacyName = parts[0];
      if (parts.length === 2) {
        // Could be "Name, City" or "Name, Address"
        // If it looks like a city (short, no numbers), treat as city
        if (parts[1].length < 20 && !/\d/.test(parts[1])) {
          city = parts[1];
        } else {
          address = parts[1];
        }
      } else {
        // "Name, Address, City"
        address = parts.slice(1, -1).join(", ");
        city = parts[parts.length - 1];
      }
    }
  }

  try {
    // Use the community pharmacies list page instead of search
    const listUrl = "https://www.bcpharmacists.org/list-community-pharmacies";
    
    // Fetch the list page
    const response = await fetch(listUrl, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status}`);
    }

    const html = await response.text();

    // Log a sample for debugging
    console.log("[pharmacy-route] HTML length:", html.length);
    console.log("[pharmacy-route] Search params:", { pharmacyName, address, city });
    
    // Extract a sample of the table to see the structure
    const tableSample = html.match(/\|.*?SHOPPERS.*?\|.*?LYNN VALLEY.*?\|/i);
    if (tableSample) {
      console.log("[pharmacy-route] Sample table row for Shoppers Lynn Valley:", tableSample[0]?.substring(0, 500));
    }

    // Parse the HTML table to extract pharmacy information
    const pharmacyInfo = parsePharmacyList(html, pharmacyName, address, city);

    console.log("[pharmacy-route] Parsed results:", JSON.stringify(pharmacyInfo, null, 2));

    if (!pharmacyInfo || pharmacyInfo.length === 0) {
      return NextResponse.json(
        { error: "No pharmacy found matching your search criteria." },
        { status: 404 },
      );
    }

    // Return the first matching pharmacy (or all if multiple)
    return NextResponse.json({ pharmacies: pharmacyInfo });
  } catch (error: unknown) {
    console.error("[pharmacy-route]", error);
    return NextResponse.json(
      { error: "Unable to search for pharmacy at this time." },
      { status: 502 },
    );
  }
}

function parsePharmacyResults(
  html: string,
  pharmacyName?: string,
  address?: string,
  city?: string,
): Array<{
  name: string;
  address: string;
  phone?: string;
  fax?: string;
}> {
  const pharmacies: Array<{
    name: string;
    address: string;
    phone?: string;
    fax?: string;
  }> = [];

  // Remove script and style tags for cleaner parsing
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, ""); // Remove comments

  // Try multiple parsing strategies
  
  // Strategy 1: Look for structured data in tables or divs
  // Pattern for pharmacy entries in search results - be more flexible
  const entryPatterns = [
    /<tr[^>]*>[\s\S]{50,2000}?<\/tr>/gi, // Any table row with substantial content
    /<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class="[^"]*pharmacy[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
    /<li[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/li>/gi,
    /<article[^>]*>[\s\S]{50,2000}?<\/article>/gi,
    /<section[^>]*>[\s\S]{50,2000}?<\/section>/gi,
  ];

  for (const pattern of entryPatterns) {
    const matches = cleanHtml.matchAll(pattern);
    for (const match of matches) {
      const entry = match[0];
      const text = entry.replace(/<[^>]+>/g, " | ").replace(/\s+/g, " ").trim();
      
      if (text.length < 20) continue; // Skip very short entries

      // Extract phone (BC format: various patterns)
      // Try to find phone in the HTML structure first (might be in specific tags)
      let phone: string | undefined;
      const phoneHtmlPatterns = [
        /<[^>]*tel[^>]*>[\s\S]*?([\d\-\(\)\s]{10,15})[\s\S]*?<\/[^>]*>/i,
        /<[^>]*phone[^>]*>[\s\S]*?([\d\-\(\)\s]{10,15})[\s\S]*?<\/[^>]*>/i,
        /tel[^>]*>([^<]{10,20})</i,
        /phone[^>]*>([^<]{10,20})</i,
      ];
      
      for (const pattern of phoneHtmlPatterns) {
        const match = entry.match(pattern);
        if (match) {
          const phoneNum = match[1]?.trim().replace(/[^\d\-\(\)\s]/g, "");
          if (phoneNum && phoneNum.length >= 10) {
            phone = phoneNum;
            break;
          }
        }
      }

      // If not found in HTML structure, try text patterns
      if (!phone) {
        const phonePatterns = [
          /Tel[:\s]*([\d\-\(\)\s]{10,15})/i,
          /Phone[:\s]*([\d\-\(\)\s]{10,15})/i,
          /\(?\d{3}\)?\s*[\-\.]?\s*\d{3}[\-\.]?\s*\d{4}/,
          /(\d{3}[\-\.\s]?\d{3}[\-\.\s]?\d{4})/,
          /\((\d{3})\)\s*(\d{3})[\-\.]?(\d{4})/,
        ];
        for (const phonePattern of phonePatterns) {
          const phoneMatch = text.match(phonePattern);
          if (phoneMatch) {
            phone = phoneMatch[1]?.trim() || phoneMatch[0]?.trim();
            // Clean up phone number
            phone = phone.replace(/\s+/g, " ").trim();
            if (phone.length >= 10) break;
          }
        }
      }

      // Extract fax - similar approach
      let fax: string | undefined;
      const faxHtmlPatterns = [
        /<[^>]*fax[^>]*>[\s\S]*?([\d\-\(\)\s]{10,15})[\s\S]*?<\/[^>]*>/i,
        /fax[^>]*>([^<]{10,20})</i,
      ];
      
      for (const pattern of faxHtmlPatterns) {
        const match = entry.match(pattern);
        if (match) {
          const faxNum = match[1]?.trim().replace(/[^\d\-\(\)\s]/g, "");
          if (faxNum && faxNum.length >= 10) {
            fax = faxNum;
            break;
          }
        }
      }

      if (!fax) {
        const faxPatterns = [
          /Fax[:\s]*([\d\-\(\)\s]{10,15})/i,
          /F[:\s]*([\d\-\(\)\s]{10,15})/i,
        ];
        for (const faxPattern of faxPatterns) {
          const faxMatch = text.match(faxPattern);
          if (faxMatch) {
            fax = faxMatch[1]?.trim();
            fax = fax.replace(/\s+/g, " ").trim();
            if (fax.length >= 10) break;
          }
        }
      }

      // Extract address (look for street addresses with BC)
      const addressPatterns = [
        /(\d+\s+[A-Za-z0-9\s\-\#]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Lane|Ln|Place|Pl)[^,<]*,\s*[A-Za-z\s]+,\s*BC[^<]*)/i,
        /([A-Za-z0-9\s\-\#]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd)[^,<]*,\s*[A-Za-z\s]+,\s*BC[^<]*)/i,
      ];
      let extractedAddress: string | undefined;
      for (const addrPattern of addressPatterns) {
        const addrMatch = text.match(addrPattern);
        if (addrMatch) {
          extractedAddress = addrMatch[1]?.trim();
          break;
        }
      }

      // Extract pharmacy name (text before address or phone)
      let name: string | undefined;
      const nameParts = text.split(/\||Tel|Phone|Fax|Address/i);
      if (nameParts[0]) {
        name = nameParts[0].trim();
        // Clean up common prefixes/suffixes
        name = name.replace(/^(Pharmacy|Pharm|Rx)\s*/i, "").trim();
      }

      if (name && name.length > 2) {
        // Check if this matches our search criteria
        const searchName = (pharmacyName || "").toLowerCase();
        const searchAddr = (address || "").toLowerCase();
        const searchCity = (city || "").toLowerCase();
        
        const matchesName = !pharmacyName || 
          name.toLowerCase().includes(searchName) ||
          searchName.includes(name.toLowerCase());
        
        const matchesAddress = !address ||
          (extractedAddress && extractedAddress.toLowerCase().includes(searchAddr)) ||
          (address && extractedAddress && searchAddr.includes(extractedAddress.toLowerCase()));

        const matchesCity = !city ||
          (extractedAddress && extractedAddress.toLowerCase().includes(searchCity));

        if (matchesName && (matchesAddress || matchesCity)) {
          pharmacies.push({
            name: name,
            address: extractedAddress || address || "Address not found",
            phone,
            fax,
          });
        }
      }
    }
  }

  // Strategy 2: Look for phone/fax in the entire page (might be in different sections)
  // Extract all phone numbers from the page
  const allPhoneMatches = Array.from(cleanHtml.matchAll(/(?:Tel|Phone|telephone)[:\s]*([\d\-\(\)\s]{10,15})/gi));
  const allFaxMatches = Array.from(cleanHtml.matchAll(/Fax[:\s]*([\d\-\(\)\s]{10,15})/gi));
  
  // Also try more flexible phone patterns
  const flexiblePhonePattern = /(\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4})/g;
  const allFlexiblePhones = Array.from(cleanHtml.matchAll(flexiblePhonePattern));

  // Strategy 3: If no structured results, try to extract from page text
  if (pharmacies.length === 0) {
    // Look for addresses
    const addressRegex = /(\d+\s+[A-Za-z0-9\s\-\#]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Lane)[^,<]*,\s*[A-Za-z\s]+,\s*BC[^<]*)/gi;
    const addressMatches = Array.from(cleanHtml.matchAll(addressRegex));

    // Use the first phone/fax found, or try to match with address proximity
    let foundPhone: string | undefined;
    let foundFax: string | undefined;

    if (allPhoneMatches.length > 0) {
      foundPhone = allPhoneMatches[0]?.[1]?.trim();
    } else if (allFlexiblePhones.length > 0) {
      foundPhone = allFlexiblePhones[0]?.[0]?.trim();
    }

    if (allFaxMatches.length > 0) {
      foundFax = allFaxMatches[0]?.[1]?.trim();
    }

    if (addressMatches.length > 0 || foundPhone) {
      pharmacies.push({
        name: pharmacyName || "Pharmacy",
        address: addressMatches[0]?.[1]?.trim() || address || "Address not found",
        phone: foundPhone,
        fax: foundFax,
      });
    }
  } else {
    // If we found pharmacies but they're missing phone/fax, try to add them
    for (const pharmacy of pharmacies) {
      if (!pharmacy.phone && allPhoneMatches.length > 0) {
        pharmacy.phone = allPhoneMatches[0]?.[1]?.trim();
      } else if (!pharmacy.phone && allFlexiblePhones.length > 0) {
        pharmacy.phone = allFlexiblePhones[0]?.[0]?.trim();
      }
      if (!pharmacy.fax && allFaxMatches.length > 0) {
        pharmacy.fax = allFaxMatches[0]?.[1]?.trim();
      }
    }
  }

  return pharmacies;
}

function parsePharmacyList(
  html: string,
  pharmacyName?: string,
  address?: string,
  city?: string,
): Array<{
  name: string;
  address: string;
  phone?: string;
  fax?: string;
}> {
  const pharmacies: Array<{
    name: string;
    address: string;
    phone?: string;
    fax?: string;
  }> = [];

  // The list page contains an HTML table with pharmacy data
  // Format: <tr><td>NAME</td><td>ADDRESS</td><td>MANAGER</td><td>PHONE</td><td>FAX</td></tr>
  
  // Extract HTML table rows
  const htmlTablePattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const htmlRows = Array.from(html.matchAll(htmlTablePattern));
  
  console.log("[pharmacy-route] Found", htmlRows.length, "HTML table rows");
  
  // Also try pipe-separated format as fallback (in case it's rendered as markdown)
  const tableRowPattern = /\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|/g;
  const pipeRows = Array.from(html.matchAll(tableRowPattern));
  
  console.log("[pharmacy-route] Found", pipeRows.length, "pipe-separated rows");
  
  // Prefer HTML table rows if we found them
  const useHtmlRows = htmlRows.length > 0;
  const allRows = useHtmlRows ? htmlRows : pipeRows;
  
  // For debugging: find and log a Shoppers row
  if (useHtmlRows) {
    for (const rowMatch of htmlRows.slice(0, 100)) {
      const rowHtml = rowMatch[1]; // The content between <tr> tags
      const tdMatches = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      if (tdMatches && tdMatches.length >= 5) {
        const name = tdMatches[0]?.replace(/<[^>]+>/g, "").trim() || "";
        if (name.toLowerCase().includes("shoppers") && name.toLowerCase().includes("291")) {
          console.log("[pharmacy-route] Found Shoppers #291 HTML row:", {
            name: tdMatches[0]?.replace(/<[^>]+>/g, "").trim(),
            address: tdMatches[1]?.replace(/<[^>]+>/g, "").trim(),
            manager: tdMatches[2]?.replace(/<[^>]+>/g, "").trim(),
            phone: tdMatches[3]?.replace(/<[^>]+>/g, "").trim(),
            fax: tdMatches[4]?.replace(/<[^>]+>/g, "").trim(),
            tdCount: tdMatches.length
          });
          break;
        }
      }
    }
  }

  // Normalize search terms
  const searchName = (pharmacyName || "").toLowerCase().trim();
  // Extract key parts from address for better matching
  let searchAddr = (address || "").toLowerCase().trim();
  // Extract street number if present
  const streetNumMatch = searchAddr.match(/(\d+)/);
  const searchStreetNum = streetNumMatch?.[1];
  // Extract street name (remove number, city, etc.)
  const streetNameMatch = searchAddr.match(/\d+\s+(.+?)(?:,|$)/);
  const searchStreetName = streetNameMatch?.[1]?.trim();
  
  const searchCity = (city || "").toLowerCase().replace(/,\s*bc$/i, "").trim();
  
  console.log("[pharmacy-route] Search criteria:", { 
    searchName, 
    searchAddr, 
    searchStreetNum, 
    searchStreetName, 
    searchCity 
  });

  // Process table rows (HTML or pipe-separated)
  for (const rowMatch of allRows) {
    let name = "";
    let fullAddress = "";
    let manager = "";
    let phone = "";
    let fax = "";
    
    if (useHtmlRows) {
      // Parse HTML table row: <tr><td>...</td><td>...</td>...</tr>
      const rowHtml = rowMatch[1]; // Content between <tr> tags
      const tdMatches = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      
      if (!tdMatches || tdMatches.length < 5) continue; // Need at least 5 columns
      
      // Extract text content from each <td>
      name = tdMatches[0]?.replace(/<[^>]+>/g, "").trim() || "";
      fullAddress = tdMatches[1]?.replace(/<[^>]+>/g, "").trim() || "";
      manager = tdMatches[2]?.replace(/<[^>]+>/g, "").trim() || "";
      phone = tdMatches[3]?.replace(/<[^>]+>/g, "").trim() || "";
      fax = tdMatches[4]?.replace(/<[^>]+>/g, "").trim() || "";
    } else {
      // Parse pipe-separated row: | name | address | manager | phone | fax |
      // Need at least 6 elements: [0]=full match, [1-5]=5 columns
      if (rowMatch.length < 6) {
        if (rowMatch.length < 5) continue; // Need at least name, address, manager, phone
      }
      
      name = rowMatch[1]?.trim() || "";
      fullAddress = rowMatch[2]?.trim() || "";
      manager = rowMatch[3]?.trim() || "";
      phone = rowMatch[4]?.trim() || "";
      fax = rowMatch[5]?.trim() || "";
    }
    
    // Debug: log the raw row data for the matched pharmacy
    if (name.toLowerCase().includes("shoppers") && fullAddress.toLowerCase().includes("lynn valley")) {
      console.log("[pharmacy-route] Raw row data:", {
        name,
        address: fullAddress,
        manager,
        phone,
        fax,
        isHtmlRow: useHtmlRows,
        fullRowText: useHtmlRows ? rowMatch[0]?.substring(0, 500) : rowMatch[0]?.substring(0, 500)
      });
    }

    // Skip header rows
    if (name.toLowerCase().includes("pharmacy name") || 
        name.toLowerCase().includes("address") ||
        name.length < 2) {
      continue;
    }
    
    // If fax is empty, try multiple extraction methods
    const originalFax = fax;
    if (!fax || fax.length < 10) {
      // Get the raw row text for fallback extraction
      const rowText = useHtmlRows 
        ? (rowMatch[0] || rowMatch[1] || "") // Full match or content
        : (rowMatch[0] || ""); // Full match for pipe-separated
      
      // Method 1: Directly split by pipe and get the 6th segment (index 5)
      const pipeParts = rowText.split("|");
      if (pipeParts.length >= 6) {
        const potentialFax = pipeParts[5]?.trim();
        if (potentialFax && /[\d\-\(\)\s]{10,}/.test(potentialFax)) {
          const digits = potentialFax.replace(/[^\d]/g, "");
          const phoneDigits = phone.replace(/[^\d]/g, "");
          if (digits.length >= 10 && digits !== phoneDigits) {
            fax = potentialFax;
            console.log("[pharmacy-route] Method 1: Found fax in pipeParts[5]:", fax);
          }
        }
      }
      
      // Method 2: Check if there are more columns than expected in the regex match
      if ((!fax || fax.length < 10) && row.length > 6) {
        // Try columns 6, 7, 8, etc.
        for (let i = 6; i < row.length; i++) {
          const potentialFax = row[i]?.trim() || "";
          if (potentialFax && /[\d\-\(\)\s]{10,}/.test(potentialFax)) {
            const digits = potentialFax.replace(/[^\d]/g, "");
            const phoneDigits = phone.replace(/[^\d]/g, "");
            if (digits.length >= 10 && digits !== phoneDigits) {
              fax = potentialFax;
              console.log("[pharmacy-route] Method 2: Found fax in column", i, ":", fax);
              break;
            }
          }
        }
      }
      
      // Method 3: Look for phone number followed by another phone-like number (most reliable)
      if (!fax || fax.length < 10) {
        // Escape the phone number for regex
        const escapedPhone = phone.replace(/[\(\)\.\-\s]/g, "\\$&");
        // Look for phone, then pipe/space, then another phone pattern
        const phoneFaxPattern = new RegExp(`${escapedPhone}[\\s\\|]+([\\(]?\\d{3}[\\)]?[\\s\\-\\.]?\\d{3}[\\s\\-\\.]?\\d{4})`, "i");
        const phoneFaxMatch = rowText.match(phoneFaxPattern);
        if (phoneFaxMatch && phoneFaxMatch[1]) {
          const faxDigits = phoneFaxMatch[1].replace(/[^\d]/g, "");
          const phoneDigits = phone.replace(/[^\d]/g, "");
          if (faxDigits !== phoneDigits && faxDigits.length >= 10) {
            fax = phoneFaxMatch[1].trim();
            console.log("[pharmacy-route] Method 3: Found fax after phone:", fax);
          }
        }
      }
      
      // Method 4: Find all phone-like patterns and take the second one
      if (!fax || fax.length < 10) {
        const phoneDigits = phone.replace(/[^\d]/g, "");
        // Find all phone-like patterns in the row
        const allNumbers = rowText.match(/(\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4})/g);
        if (allNumbers && allNumbers.length > 1) {
          // Check each number after the first
          for (let i = 1; i < allNumbers.length; i++) {
            const potentialFax = allNumbers[i];
            const faxDigits = potentialFax.replace(/[^\d]/g, "");
            if (faxDigits !== phoneDigits && faxDigits.length >= 10) {
              fax = potentialFax.trim();
              console.log("[pharmacy-route] Method 4: Found fax as number", i, ":", fax);
              break;
            }
          }
        }
      }
      
      // Method 5: Look for "Fax:" label
      if (!fax || fax.length < 10) {
        const faxLabelPattern = /Fax[:\s]*([\d\-\(\)\s]{10,15})/i;
        const faxLabelMatch = rowText.match(faxLabelPattern);
        if (faxLabelMatch && faxLabelMatch[1]) {
          fax = faxLabelMatch[1].trim();
          console.log("[pharmacy-route] Method 5: Found fax via Fax: label:", fax);
        }
      }
      
      // Debug: if still no fax, log the row structure
      if (!fax || fax.length < 10) {
        console.log("[pharmacy-route] Could not find fax. Row structure:", {
          isHtmlRow: useHtmlRows,
          phone: phone,
          rowTextSample: rowText.substring(0, 300),
          extractedFax: fax
        });
      }
    }

    // Calculate match score for better ranking
    let matchScore = 0;
    let nameMatch = false;
    let addressMatch = false;
    let cityMatch = false;

    // Name matching with scoring - STRICT: name MUST be in pharmacy name if provided
    if (searchName) {
      const nameLower = name.toLowerCase();
      const searchNameLower = searchName.toLowerCase();
      
      // Exact match gets highest score
      if (nameLower === searchNameLower) {
        nameMatch = true;
        matchScore += 100;
      }
      // Pharmacy name contains search term (e.g., "SHOPPERS DRUG MART" contains "shoppers")
      else if (nameLower.includes(searchNameLower)) {
        nameMatch = true;
        matchScore += 80;
      }
      // Search term contains pharmacy name (less common, lower score)
      else if (searchNameLower.includes(nameLower) && nameLower.length > 5) {
        nameMatch = true;
        matchScore += 40;
      }
      // For "Shoppers" specifically, also check for common variations
      else if (searchNameLower.includes("shoppers")) {
        // Check for common Shoppers Drug Mart variations
        if (nameLower.includes("shoppers") || nameLower.includes("sdm")) {
          nameMatch = true;
          matchScore += 80;
        } else {
          // If searching for "Shoppers" but name doesn't contain it, don't match
          nameMatch = false;
          console.log("[pharmacy-route] Name mismatch - searching for 'shoppers' but pharmacy is:", name);
        }
      } else {
        // If name doesn't match at all, don't include this pharmacy
        nameMatch = false;
        console.log("[pharmacy-route] Name mismatch - no match found for:", searchNameLower, "in", nameLower);
      }
    } else {
      nameMatch = true; // No name search criteria
    }
    
    // If name doesn't match and we have a name search, skip this pharmacy entirely
    if (searchName && !nameMatch) {
      continue;
    }

    // Address matching with scoring
    const normalizedAddress = fullAddress.toLowerCase().replace(/\s+/g, " ").trim();
    
    if (searchAddr) {
      // Extract street number and name from address
      const addrStreetMatch = normalizedAddress.match(/(\d+)\s+(.+)/);
      const addrStreetNum = addrStreetMatch?.[1];
      const addrStreetName = addrStreetMatch?.[2]?.split(",")[0]?.trim();
      
      // Match on street number first (most specific)
      if (searchStreetNum && addrStreetNum) {
        if (searchStreetNum === addrStreetNum) {
          matchScore += 80; // High score for matching street number
          
          // If street name also matches, even better
          if (searchStreetName && addrStreetName) {
            if (addrStreetName.includes(searchStreetName) || searchStreetName.includes(addrStreetName)) {
              addressMatch = true;
              matchScore += 50; // Bonus for both number and name
            } else {
              // Number matches but name doesn't - still consider it if name is close
              addressMatch = true;
            }
          } else {
            addressMatch = true; // Number matches, accept it
          }
        }
      }
      
      // If no street number match, try street name match
      if (!addressMatch && searchStreetName && addrStreetName) {
        if (addrStreetName.includes(searchStreetName) || searchStreetName.includes(addrStreetName)) {
          addressMatch = true;
          matchScore += 40;
        }
      }
      
      // Fallback: contains match (lower priority)
      if (!addressMatch) {
        const normalizedSearchAddr = searchAddr.replace(/\s+/g, " ").trim();
        if (normalizedAddress.includes(normalizedSearchAddr) || normalizedSearchAddr.includes(normalizedAddress.split(",")[0])) {
          addressMatch = true;
          matchScore += 20; // Lower score for generic contains match
        }
      }
    } else {
      addressMatch = true; // No address search criteria
    }

    // City matching - "North Van" should match "North Vancouver"
    if (searchCity) {
      const normalizedCity = searchCity.toLowerCase().replace(/,\s*bc$/i, "").trim();
      const addrCity = normalizedAddress.split(",").pop()?.trim() || "";
      
      if (addrCity.includes(normalizedCity) || normalizedCity.includes(addrCity)) {
        cityMatch = true;
        matchScore += 50;
      }
      // Handle "North Van" vs "North Vancouver"
      else if ((addrCity.includes("north van") && (normalizedCity.includes("north van") || normalizedCity.includes("north vancouver"))) ||
               (addrCity.includes("north vancouver") && (normalizedCity.includes("north van") || normalizedCity.includes("north vancouver")))) {
        cityMatch = true;
        matchScore += 50;
      }
    } else {
      cityMatch = true; // No city search criteria
    }

    // Require BOTH name AND address to match (city is optional but helps with scoring)
    // This prevents matching just on name when address doesn't match
    // If we have a name search, name MUST match (already checked above with continue)
    // If we have an address search, address MUST match
    if (searchAddr && !addressMatch) {
      continue; // Skip if address doesn't match when address is provided
    }
    
    // Only include if we have required matches AND a reasonable score
    // Name match is already guaranteed if searchName was provided (due to continue above)
    // Address match is guaranteed if searchAddr was provided (due to continue above)
    if (nameMatch && addressMatch && matchScore >= 30) {
      // Clean up phone and fax numbers - preserve format like (604) 123-4567
      let cleanPhone = phone.trim();
      // Remove any non-digit, non-dash, non-parenthesis, non-space characters
      cleanPhone = cleanPhone.replace(/[^\d\-\(\)\s]/g, "").trim();
      // Format phone if it's just digits
      if (/^\d{10}$/.test(cleanPhone.replace(/[\s\-\(\)]/g, ""))) {
        const digits = cleanPhone.replace(/[\s\-\(\)]/g, "");
        cleanPhone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      }

      // Clean and format fax - use the fax we extracted earlier (which may have been found via fallback methods)
      let cleanFax = fax.trim();
      
      // If still empty, try one more time with the full row text
      if (!cleanFax || cleanFax.length < 10) {
        const rowText = row[0] || ""; // The full matched text
        
        // Split by pipes and check all segments after phone
        const segments = rowText.split("|").map(s => s.trim());
        // Phone should be around index 4-5, check segments after that
        for (let i = 5; i < segments.length; i++) {
          const seg = segments[i];
          if (seg && /[\d\-\(\)\s]{10,}/.test(seg)) {
            const digits = seg.replace(/[^\d]/g, "");
            if (digits.length >= 10 && digits.length <= 15) {
              // Make sure it's different from phone
              const phoneDigits = phone.replace(/[^\d]/g, "");
              if (digits !== phoneDigits) {
                cleanFax = seg;
                console.log("[pharmacy-route] Found fax in segment", i, ":", cleanFax);
                break;
              }
            }
          }
        }
      }
      
      // Format the fax number
      if (cleanFax && cleanFax.length >= 10) {
        // Remove any non-digit, non-dash, non-parenthesis, non-space characters
        cleanFax = cleanFax.replace(/[^\d\-\(\)\s]/g, "").trim();
        const digits = cleanFax.replace(/[\s\-\(\)]/g, "");
        
        if (digits.length === 10) {
          // Format as (604) 123-4567
          cleanFax = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        } else if (digits.length >= 10) {
          // Keep original format if it's already formatted or has extra characters
          cleanFax = cleanFax.trim();
        } else {
          cleanFax = ""; // Clear if invalid
        }
      } else {
        cleanFax = ""; // Clear if too short
      }
      
      // Final debug log
      if (name.toLowerCase().includes("shoppers") && fullAddress.toLowerCase().includes("lynn valley")) {
        const rowTextSample = useHtmlRows ? rowMatch[0]?.substring(0, 200) : rowMatch[0]?.substring(0, 200);
        console.log("[pharmacy-route] Final fax extraction:", {
          originalFax: fax,
          cleanedFax: cleanFax,
          phone: cleanPhone,
          rowTextSample: rowTextSample
        });
      }

      pharmacies.push({
        name: name,
        address: fullAddress,
        phone: cleanPhone || undefined,
        fax: cleanFax || undefined,
        _matchScore: matchScore, // Temporary field for sorting
      } as any);
      
      console.log("[pharmacy-route] Matched pharmacy:", { 
        name, 
        address: fullAddress, 
        phone: cleanPhone, 
        fax: cleanFax, 
        matchScore,
        nameMatch,
        addressMatch,
        cityMatch,
        searchName,
        searchAddr
      });
    }
  }

  // Sort by match score (highest first) and remove the temporary score field
  pharmacies.sort((a: any, b: any) => (b._matchScore || 0) - (a._matchScore || 0));
  pharmacies.forEach((p: any) => delete p._matchScore);

  // If no pipe-separated rows found, try HTML table parsing
  if (pharmacies.length === 0 && htmlRows.length > 0) {
    for (const rowMatch of htmlRows) {
      const row = rowMatch[0];
      const text = row.replace(/<[^>]+>/g, "|").replace(/\s*\|\s*/g, "|").trim();
      
      // Skip header rows
      if (text.toLowerCase().includes("pharmacy name") || 
          text.toLowerCase().includes("address") ||
          text.length < 20) {
        continue;
      }

      const parts = text.split("|").filter(p => p.trim().length > 0);
      if (parts.length < 3) continue;

      const name = parts[0]?.trim() || "";
      const fullAddress = parts[1]?.trim() || "";
      
      // Look for phone and fax in the row
      const phoneMatch = row.match(/(?:Tel|Phone)[:\s]*([\d\-\(\)\s]{10,15})/i) ||
                        row.match(/(\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4})/);
      const phone = phoneMatch ? phoneMatch[1]?.trim() : undefined;

      const faxMatch = row.match(/Fax[:\s]*([\d\-\(\)\s]{10,15})/i);
      const fax = faxMatch ? faxMatch[1]?.trim() : undefined;

      if (!name || name.length < 2) continue;

      // Check if this matches our search criteria - use STRICT matching
      let nameMatch = false;
      if (searchName) {
        const nameLower = name.toLowerCase();
        const searchNameLower = searchName.toLowerCase();
        // Pharmacy name MUST contain search term
        nameMatch = nameLower.includes(searchNameLower);
        if (!nameMatch && searchNameLower.includes("shoppers")) {
          nameMatch = nameLower.includes("shoppers") || nameLower.includes("sdm");
        }
      } else {
        nameMatch = true;
      }
      
      // Skip if name doesn't match
      if (searchName && !nameMatch) {
        continue;
      }

      let addressMatch = false;
      if (searchAddr) {
        const normalizedAddress = fullAddress.toLowerCase();
        const normalizedSearchAddr = searchAddr.toLowerCase();
        // Check for street number match first
        const searchStreetNum = searchAddr.match(/(\d+)/)?.[1];
        const addrStreetNum = normalizedAddress.match(/(\d+)/)?.[1];
        if (searchStreetNum && addrStreetNum && searchStreetNum === addrStreetNum) {
          addressMatch = true;
        } else {
          // Fallback to contains match
          addressMatch = normalizedAddress.includes(normalizedSearchAddr) ||
            normalizedSearchAddr.includes(normalizedAddress.split(",")[0]);
        }
      } else {
        addressMatch = true;
      }

      const cityMatch = !searchCity ||
        fullAddress.toLowerCase().includes(searchCity.toLowerCase()) ||
        (fullAddress.toLowerCase().includes("north van") && searchCity.toLowerCase().includes("north van"));

      // Require BOTH name and address to match
      if (nameMatch && addressMatch) {
        pharmacies.push({
          name: name,
          address: fullAddress,
          phone: phone?.replace(/[^\d\-\(\)\s]/g, "").trim() || undefined,
          fax: fax?.replace(/[^\d\-\(\)\s]/g, "").trim() || undefined,
        });
      }
    }
  }

  // If still no results, try a more flexible text-based search
  if (pharmacies.length === 0) {
    // Look for the pharmacy name in the HTML and extract surrounding context
    if (searchName) {
      const nameWords = searchName.split(/\s+/).filter(w => w.length > 2);
      if (nameWords.length > 0) {
        // Create a pattern to find the pharmacy name and nearby data
        const searchPattern = new RegExp(
          `(${nameWords[0]}[^|]*?)\\|([^|]{20,200})\\|([^|]*?)\\|([^|]*?)\\|([^|]*?)\\|([^|]*?)\\|`,
          "i"
        );
        const matches = Array.from(html.matchAll(searchPattern));
        
        for (const match of matches) {
          const name = match[1]?.trim() || "";
          const fullAddress = match[2]?.trim() || "";
          const phone = match[5]?.trim() || "";
          const fax = match[6]?.trim() || "";

          if (name && fullAddress) {
            // Apply strict name matching
            let nameMatches = true;
            if (searchName) {
              const nameLower = name.toLowerCase();
              const searchNameLower = searchName.toLowerCase();
              nameMatches = nameLower.includes(searchNameLower);
              if (!nameMatches && searchNameLower.includes("shoppers")) {
                nameMatches = nameLower.includes("shoppers") || nameLower.includes("sdm");
              }
            }
            
            // Apply strict address matching
            let addressMatches = true;
            if (searchAddr) {
              const normalizedAddress = fullAddress.toLowerCase();
              const normalizedSearchAddr = searchAddr.toLowerCase();
              const searchStreetNum = searchAddr.match(/(\d+)/)?.[1];
              const addrStreetNum = normalizedAddress.match(/(\d+)/)?.[1];
              if (searchStreetNum && addrStreetNum) {
                addressMatches = searchStreetNum === addrStreetNum;
              } else {
                addressMatches = normalizedAddress.includes(normalizedSearchAddr);
              }
            }
            
            if (nameMatches && addressMatches) {
              pharmacies.push({
                name: name,
                address: fullAddress,
                phone: phone.replace(/[^\d\-\(\)\s]/g, "").trim() || undefined,
                fax: fax.replace(/[^\d\-\(\)\s]/g, "").trim() || undefined,
              });
              break; // Take first match
            }
          }
        }
      }
    }
  }

  return pharmacies;
}

