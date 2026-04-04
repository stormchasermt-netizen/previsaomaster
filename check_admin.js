const fs = require('fs');
let code = fs.readFileSync('app/admin/radares/page.tsx', 'utf8');

// Also ensure we replace in page.tsx if there are any hardcoded traces (we know we made it use IPMET_FIXED_BOUNDS from lib)
// So as long as IPMET_FIXED_BOUNDS is imported, app/admin/radares/page.tsx is automatically updated.

// But let's check for any strings with "-19.4975" just in case.
const regex = /-19\.4975/;
if (code.match(regex)) {
  console.log("Found hardcoded value in page.tsx!");
} else {
  console.log("No hardcoded value found in page.tsx");
}
