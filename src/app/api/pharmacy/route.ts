import { NextResponse } from "next/server";
import { logDebug } from "@/lib/secure-logger";
import { getRequestId, logRequestMeta } from "@/lib/request-metadata";

export async function POST(request: Request) {
  const requestId = getRequestId(request.headers);
  const started = Date.now();
  let status = 200;
  let payload: { pharmacyName?: string; address?: string; city?: string };

  try {
    payload = await request.json();
  } catch {
    status = 400;
    const res = NextResponse.json(
      { error: "Invalid JSON body." },
      { status },
    );
    logRequestMeta("/api/pharmacy", requestId, status, Date.now() - started);
    return res;
  }

  let { pharmacyName, address, city } = payload;

  // If only one field is provided, try to parse it intelligently
  if (!pharmacyName && !address && !city) {
    status = 400;
    const res = NextResponse.json(
      { error: "Please provide pharmacy name, address, or city." },
      { status },
    );
    logRequestMeta("/api/pharmacy", requestId, status, Date.now() - started);
    return res;
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

    // Parse the HTML table to extract pharmacy information
    const pharmacyInfo = parsePharmacyList(html, pharmacyName, address, city);

    if (!pharmacyInfo || pharmacyInfo.length === 0) {
      return NextResponse.json(
        { error: "No pharmacy found matching your search criteria." },
        { status: 404 },
      );
    }

    // Return the first matching pharmacy (or all if multiple)
    const res = NextResponse.json({ pharmacies: pharmacyInfo });
    logRequestMeta("/api/pharmacy", requestId, status, Date.now() - started);
    return res;
  } catch (error: unknown) {
    console.error("[pharmacy-route] Lookup failed");
    logDebug("[pharmacy-route] Error details", {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    status = 502;
    const res = NextResponse.json(
      { error: "Unable to search for pharmacy at this time." },
      { status },
    );
    logRequestMeta("/api/pharmacy", requestId, status, Date.now() - started);
    return res;
  }
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
  
  // Also try pipe-separated format as fallback (in case it's rendered as markdown)
  const tableRowPattern = /\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|/g;
  const pipeRows = Array.from(html.matchAll(tableRowPattern));
  
  // Prefer HTML table rows if we found them
  const useHtmlRows = htmlRows.length > 0;
  const allRows = useHtmlRows ? htmlRows : pipeRows;

  // Normalize search terms
  const searchName = (pharmacyName || "").toLowerCase().trim();
  // Extract key parts from address for better matching
  const searchAddr = (address || "").toLowerCase().trim();
  // Extract street number if present
  const streetNumMatch = searchAddr.match(/(\d+)/);
  const searchStreetNum = streetNumMatch?.[1];
  // Extract street name (remove number, city, etc.)
  // Handle both cases: with number "123 main st" and without "main st"
  let searchStreetName: string | undefined;
  const streetNameMatch = searchAddr.match(/\d+\s+(.+?)(?:,|$)/);
  if (streetNameMatch) {
    searchStreetName = streetNameMatch[1]?.trim();
  } else {
    // No number, try to extract street name directly (before comma if present)
    const parts = searchAddr.split(",");
    searchStreetName = parts[0]?.trim();
  }
  
  const searchCity = (city || "").toLowerCase().replace(/,\s*bc$/i, "").trim();

  // Process table rows (HTML or pipe-separated)
  for (const rowMatch of allRows) {
    let name = "";
    let fullAddress = "";
    let manager = "";
    let phone = "";
    let fax = "";
    let tdMatches: RegExpMatchArray | null = null;
    
    if (useHtmlRows) {
      // Parse HTML table row: <tr><td>...</td><td>...</td>...</tr>
      const rowHtml = rowMatch[1]; // Content between <tr> tags
      tdMatches = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
      
      if (!tdMatches || tdMatches.length < 5) continue; // Need at least 5 columns
      
      // Extract text content from each <td>
      name = tdMatches[0]?.replace(/<[^>]+>/g, "").trim() || "";
      fullAddress = tdMatches[1]?.replace(/<[^>]+>/g, "").trim() || "";
      manager = tdMatches[2]?.replace(/<[^>]+>/g, "").trim() || "";
      phone = tdMatches[3]?.replace(/<[^>]+>/g, "").trim() || "";
      fax = tdMatches[4]?.replace(/<[^>]+>/g, "").trim() || "";
    } else {
      // Parse pipe-separated row: | name | address | manager | phone | fax |
      if (rowMatch.length < 6) {
        if (rowMatch.length < 5) continue; // Need at least name, address, manager, phone
      }
      
      name = rowMatch[1]?.trim() || "";
      fullAddress = rowMatch[2]?.trim() || "";
      manager = rowMatch[3]?.trim() || "";
      phone = rowMatch[4]?.trim() || "";
      fax = rowMatch[5]?.trim() || "";
    }

    // Skip header rows
    if (name.toLowerCase().includes("pharmacy name") || 
        name.toLowerCase().includes("address") ||
        name.length < 2) {
      continue;
    }
    
    // If fax is empty, try multiple extraction methods
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
          }
        }
      }
      
      // Method 2: Check if there are more columns than expected
      if (!fax || fax.length < 10) {
        if (useHtmlRows && tdMatches && tdMatches.length > 5) {
          // Try columns 5, 6, 7, etc. for HTML rows
          for (let i = 5; i < tdMatches.length; i++) {
            const potentialFax = tdMatches[i]?.replace(/<[^>]+>/g, "").trim() || "";
            if (potentialFax && /[\d\-\(\)\s]{10,}/.test(potentialFax)) {
              const digits = potentialFax.replace(/[^\d]/g, "");
              const phoneDigits = phone.replace(/[^\d]/g, "");
              if (digits.length >= 10 && digits !== phoneDigits) {
                fax = potentialFax;
                break;
              }
            }
          }
        } else if (!useHtmlRows && pipeParts.length > 6) {
          // Try columns 6, 7, 8, etc. for pipe-separated rows
          for (let i = 6; i < pipeParts.length; i++) {
            const potentialFax = pipeParts[i]?.trim() || "";
            if (potentialFax && /[\d\-\(\)\s]{10,}/.test(potentialFax)) {
              const digits = potentialFax.replace(/[^\d]/g, "");
              const phoneDigits = phone.replace(/[^\d]/g, "");
              if (digits.length >= 10 && digits !== phoneDigits) {
                fax = potentialFax;
                break;
              }
            }
          }
        }
      }
      
      // Method 3: Look for phone number followed by another phone-like number
      if (!fax || fax.length < 10) {
        const escapedPhone = phone.replace(/[\(\)\.\-\s]/g, "\\$&");
        const phoneFaxPattern = new RegExp(`${escapedPhone}[\\s\\|]+([\\(]?\\d{3}[\\)]?[\\s\\-\\.]?\\d{3}[\\s\\-\\.]?\\d{4})`, "i");
        const phoneFaxMatch = rowText.match(phoneFaxPattern);
        if (phoneFaxMatch && phoneFaxMatch[1]) {
          const faxDigits = phoneFaxMatch[1].replace(/[^\d]/g, "");
          const phoneDigits = phone.replace(/[^\d]/g, "");
          if (faxDigits !== phoneDigits && faxDigits.length >= 10) {
            fax = phoneFaxMatch[1].trim();
          }
        }
      }
      
      // Method 4: Find all phone-like patterns and take the second one
      if (!fax || fax.length < 10) {
        const phoneDigits = phone.replace(/[^\d]/g, "");
        const allNumbers = rowText.match(/(\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4})/g);
        if (allNumbers && allNumbers.length > 1) {
          for (let i = 1; i < allNumbers.length; i++) {
            const potentialFax = allNumbers[i];
            const faxDigits = potentialFax.replace(/[^\d]/g, "");
            if (faxDigits !== phoneDigits && faxDigits.length >= 10) {
              fax = potentialFax.trim();
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
        }
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
        if (nameLower.includes("shoppers") || nameLower.includes("sdm")) {
          nameMatch = true;
          matchScore += 80;
        } else {
          nameMatch = false;
        }
      } else {
        nameMatch = false;
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
      // Normalize street name abbreviations for better matching
      const normalizeStreetName = (name: string): string => {
        return name
          .toLowerCase()
          .replace(/\b(street|st)\b/g, "st")
          .replace(/\b(avenue|ave)\b/g, "ave")
          .replace(/\b(road|rd)\b/g, "rd")
          .replace(/\b(drive|dr)\b/g, "dr")
          .replace(/\b(boulevard|blvd)\b/g, "blvd")
          .replace(/\b(way)\b/g, "way")
          .replace(/\b(lane|ln)\b/g, "ln")
          .replace(/\b(place|pl)\b/g, "pl")
          .replace(/[^\w\s]/g, "")
          .trim();
      };
      
      // Extract street number and name from address
      const addrStreetMatch = normalizedAddress.match(/(\d+)\s+(.+)/);
      const addrStreetNum = addrStreetMatch?.[1];
      const addrStreetName = addrStreetMatch?.[2]?.split(",")[0]?.trim();
      const normalizedAddrStreetName = addrStreetName ? normalizeStreetName(addrStreetName) : "";
      
      // Normalize search street name
      const normalizedSearchStreetName = searchStreetName ? normalizeStreetName(searchStreetName) : "";
      
      // Match on street number first (most specific)
      if (searchStreetNum && addrStreetNum) {
        if (searchStreetNum === addrStreetNum) {
          matchScore += 80;
          
          // If street name also matches, even better
          if (normalizedSearchStreetName && normalizedAddrStreetName) {
            if (normalizedAddrStreetName.includes(normalizedSearchStreetName) || 
                normalizedSearchStreetName.includes(normalizedAddrStreetName)) {
              addressMatch = true;
              matchScore += 50;
            } else {
              addressMatch = true; // Number matches, accept it
            }
          } else {
            addressMatch = true;
          }
        }
      }
      
      // If no street number match, try street name match (with normalization)
      if (!addressMatch && normalizedSearchStreetName && normalizedAddrStreetName) {
        if (normalizedAddrStreetName.includes(normalizedSearchStreetName) || 
            normalizedSearchStreetName.includes(normalizedAddrStreetName)) {
          addressMatch = true;
          matchScore += 40;
        }
      }
      
      // Fallback: contains match with normalization (lower priority)
      if (!addressMatch) {
        const normalizedSearchAddr = normalizeStreetName(searchAddr);
        const normalizedAddrFirstPart = normalizeStreetName(normalizedAddress.split(",")[0]);
        
        if (normalizedAddrFirstPart.includes(normalizedSearchAddr) || 
            normalizedSearchAddr.includes(normalizedAddrFirstPart) ||
            normalizedAddress.includes(searchAddr.toLowerCase()) ||
            searchAddr.toLowerCase().includes(normalizedAddress.split(",")[0])) {
          addressMatch = true;
          matchScore += 20;
        }
      }
    } else {
      addressMatch = true; // No address search criteria
    }

    // City matching - STRICT: city MUST match if provided
    // Handle variations like "North Van" vs "North Vancouver", "West Van" vs "West Vancouver"
    if (searchCity) {
      const normalizedCity = searchCity.toLowerCase().replace(/,\s*bc$/i, "").trim();
      // Extract city from address (usually the last part after comma)
      const addrCity = normalizedAddress.split(",").pop()?.trim().toLowerCase() || "";
      // Also try extracting from the full address in case format is different
      const addrCityParts = normalizedAddress.split(",").map(p => p.trim().toLowerCase());
      
      // Helper function to check if cities match (handles abbreviations)
      const citiesMatch = (city1: string, city2: string): boolean => {
        const c1 = city1.toLowerCase().trim();
        const c2 = city2.toLowerCase().trim();
        
        // Exact match
        if (c1 === c2) return true;
        
        // One contains the other (handles "North Van" vs "North Vancouver")
        if (c1.includes(c2) || c2.includes(c1)) return true;
        
        // Handle common abbreviations
        const abbreviations: Record<string, string[]> = {
          "north van": ["north vancouver", "north van"],
          "north vancouver": ["north van", "north vancouver"],
          "west van": ["west vancouver", "west van"],
          "west vancouver": ["west van", "west vancouver"],
          "east van": ["east vancouver", "east van"],
          "east vancouver": ["east van", "east vancouver"],
          "van": ["vancouver"],
          "vancouver": ["van"],
        };
        
        const c1Variants = abbreviations[c1] || [c1];
        const c2Variants = abbreviations[c2] || [c2];
        
        // Check if any variants match
        for (const v1 of c1Variants) {
          for (const v2 of c2Variants) {
            if (v1 === v2 || v1.includes(v2) || v2.includes(v1)) {
              return true;
            }
          }
        }
        
        return false;
      };
      
      // Check against the last part (most common format)
      if (citiesMatch(normalizedCity, addrCity)) {
        cityMatch = true;
        matchScore += 50;
      }
      // Also check all parts of the address in case city appears elsewhere
      else {
        for (const part of addrCityParts) {
          if (citiesMatch(normalizedCity, part)) {
        cityMatch = true;
        matchScore += 50;
            break;
          }
        }
      }
    } else {
      cityMatch = true; // No city search criteria
    }

    // Require name, address, AND city to match if provided
    // But be more lenient with generic addresses like "main st"
    const isGenericAddress = searchAddr && (
      searchAddr.match(/^(main|park|oak|elm|pine|maple|cedar|spruce|birch|willow)\s+(st|street|rd|road|ave|avenue|dr|drive)$/i) ||
      searchAddr.length < 10
    );
    
    if (searchAddr && !addressMatch && !isGenericAddress) {
      continue; // Skip if address doesn't match when address is provided (unless it's generic)
    }
    
    // For generic addresses, require at least name match and lower score threshold
    if (isGenericAddress && !addressMatch) {
      // Still allow if name matches and we have a reasonable score
      if (!nameMatch || matchScore < 20) {
        continue;
      }
    }
    
    // STRICT: If city is provided, it MUST match
    if (searchCity && !cityMatch) {
      continue; // Skip if city doesn't match when city is provided
    }
    
    // Only include if we have required matches AND a reasonable score
    // Lower threshold for generic addresses
    const minScore = isGenericAddress ? 20 : 30;
    if (nameMatch && addressMatch && cityMatch && matchScore >= minScore) {
      // Clean up phone and fax numbers - preserve format like (604) 123-4567
      let cleanPhone = phone.trim();
      cleanPhone = cleanPhone.replace(/[^\d\-\(\)\s]/g, "").trim();
      // Format phone if it's just digits
      if (/^\d{10}$/.test(cleanPhone.replace(/[\s\-\(\)]/g, ""))) {
        const digits = cleanPhone.replace(/[\s\-\(\)]/g, "");
        cleanPhone = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
      }

      // Clean and format fax
      let cleanFax = fax.trim();
      
      // If still empty, try one more time with the full row text
      if (!cleanFax || cleanFax.length < 10) {
        const rowTextForFax = useHtmlRows 
          ? (rowMatch[0] || rowMatch[1] || "")
          : (rowMatch[0] || "");
        
        const segments = rowTextForFax.split("|").map(s => s.trim());
        for (let i = 5; i < segments.length; i++) {
          const seg = segments[i];
          if (seg && /[\d\-\(\)\s]{10,}/.test(seg)) {
            const digits = seg.replace(/[^\d]/g, "");
            if (digits.length >= 10 && digits.length <= 15) {
              const phoneDigits = phone.replace(/[^\d]/g, "");
              if (digits !== phoneDigits) {
                cleanFax = seg;
                break;
              }
            }
          }
        }
      }
      
      // Format the fax number
      if (cleanFax && cleanFax.length >= 10) {
        cleanFax = cleanFax.replace(/[^\d\-\(\)\s]/g, "").trim();
        const digits = cleanFax.replace(/[\s\-\(\)]/g, "");
        
        if (digits.length === 10) {
          cleanFax = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
        } else if (digits.length >= 10) {
          cleanFax = cleanFax.trim();
        } else {
          cleanFax = "";
        }
      } else {
        cleanFax = "";
      }

      pharmacies.push({
        name: name,
        address: fullAddress,
        phone: cleanPhone || undefined,
        fax: cleanFax || undefined,
        _matchScore: matchScore, // Temporary field for sorting
      } as any);
    }
  }

  // Sort by match score (highest first) and remove the temporary score field
  pharmacies.sort((a: any, b: any) => (b._matchScore || 0) - (a._matchScore || 0));
  pharmacies.forEach((p: any) => delete p._matchScore);

  return pharmacies;
}
