import { SocialKit, AuditReport, ResearchSummary, ArticleData } from "@/types/journalist.types";

export const buildExportHTML = (
  title: string,
  bodyContent: string,
  imageUrl?: string | null,
  socialKit?: SocialKit | null,
  audit?: AuditReport | null,
  researchSummary?: ResearchSummary | null,
  sources?: Array<{ title: string; url: string; description: string }> | null,
  stats?: { words: number; readingTime: number } | null,
  dataInsights?: Array<{ label: string; value: number; context: string }> | null
) => {
  const imageSection = imageUrl
    ? `
      <div style="margin: 0 0 40px 0; position: relative; overflow: hidden; border-radius: 12px;">
        <img src="${imageUrl}" style="width:100%; height: auto; display: block;" alt="Cover image" />
        <div style="position: absolute; bottom: 0; left: 0; right: 0; background: #000000; background: linear-gradient(to top, rgba(0,0,0,0.7), transparent); padding: 20px; color: white;">
          <p style="margin: 0; font-size: 11pt; font-weight: 500; letter-spacing: 0.5px;">AI-GENERATED COVER</p>
        </div>
      </div>
    `
    : "";

  const statsSection = stats
    ? `
      <table style="width: 100%; border-collapse: separate; border-spacing: 20px 0; margin: 30px -20px;">
        <tr>
          <td style="width: 50%; background: #667eea; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white;">
            <div style="font-size: 10pt; font-weight: 600; letter-spacing: 1px; opacity: 0.9; margin-bottom: 8px;">WORD COUNT</div>
            <div style="font-size: 36pt; font-weight: 800; line-height: 1;">${stats.words.toLocaleString()}</div>
          </td>
          <td style="width: 50%; background: #f5576c; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 25px; border-radius: 12px; color: white;">
            <div style="font-size: 10pt; font-weight: 600; letter-spacing: 1px; opacity: 0.9; margin-bottom: 8px;">READ TIME</div>
            <div style="font-size: 36pt; font-weight: 800; line-height: 1;">${stats.readingTime} <span style="font-size: 18pt;">min</span></div>
          </td>
        </tr>
      </table>
    `
    : "";

  const insightsSection = dataInsights?.length
    ? `
      <div style="margin-top: 60px; page-break-before: always;">
        <div style="border-left: 5px solid #f59e0b; padding-left: 20px; margin-bottom: 30px;">
          <h2 style="color: #1a202c; font-size: 28pt; margin: 0; font-weight: 800;">Data Insights</h2>
          <p style="color: #718096; font-size: 11pt; margin: 8px 0 0 0;">Statistical breakdowns and key metrics</p>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          ${dataInsights.map(insight => `
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e2e8f0; width: 40%;">
                <div style="font-weight: 700; color: #2d3748;">${insight.label}</div>
              </td>
              <td style="padding: 15px; border-bottom: 1px solid #e2e8f0; width: 15%;">
                <div style="font-weight: 800; color: #4f46e5; font-size: 14pt;">${insight.value}%</div>
              </td>
              <td style="padding: 15px; border-bottom: 1px solid #e2e8f0;">
                <div style="color: #718096; font-size: 10pt;">${insight.context}</div>
              </td>
            </tr>
          `).join('')}
        </table>
      </div>
    `
    : "";

  const researchSection = researchSummary
    ? `
      <div style="margin-top: 60px; page-break-before: always;">
        <div style="border-left: 5px solid #667eea; padding-left: 20px; margin-bottom: 30px;">
          <h2 style="color: #1a202c; font-size: 28pt; margin: 0; font-weight: 800;">Research Intelligence</h2>
          <p style="color: #718096; font-size: 11pt; margin: 8px 0 0 0;">Evidence-based insights and data points</p>
        </div>

        <table style="width: 100%; border-collapse: separate; border-spacing: 25px 0; margin: 0 -25px 25px -25px;">
          <tr>
            <td style="width: 50%; vertical-align: top; background: #f7fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px;">
              ${researchSummary.core_facts?.length
                ? `
                <h3 style="color: #667eea; font-size: 14pt; margin: 0 0 15px 0; font-weight: 700;">Core Investigative Facts</h3>
                <ul style="margin: 0; padding-left: 20px; color: #2d3748;">
                  ${researchSummary.core_facts.map(f => `<li style="margin-bottom: 10px; line-height: 1.6;">${f}</li>`).join("")}
                </ul>
              `
                : ""}
            </td>
            <td style="width: 50%; vertical-align: top; background: #f7fafc; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px;">
              ${researchSummary.statistics?.length
                ? `
                <h3 style="color: #f5576c; font-size: 14pt; margin: 0 0 15px 0; font-weight: 700;">Statistical Data</h3>
                <ul style="margin: 0; padding-left: 20px; color: #2d3748;">
                  ${researchSummary.statistics.map(s => `<li style="margin-bottom: 10px; line-height: 1.6;">${s}</li>`).join("")}
                </ul>
              `
                : ""}
            </td>
          </tr>
        </table>

        ${researchSummary.contrarian_perspectives?.length || researchSummary.hidden_challenges?.length
          ? `
          <div style="background: #fdf2f8; border: 2px solid #f472b6; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #db2777; font-size: 14pt; margin: 0 0 15px 0; font-weight: 700;">Critical Perspectives & Challenges</h3>
            ${researchSummary.contrarian_perspectives?.length ? `
              <strong style="display: block; color: #db2777; margin-bottom: 8px; font-size: 10pt; text-transform: uppercase;">Contrarian Views</strong>
              <ul style="margin: 0 0 15px 0; padding-left: 20px; color: #2d3748;">
                ${researchSummary.contrarian_perspectives.map(p => `<li style="margin-bottom: 6px;">${p}</li>`).join("")}
              </ul>
            ` : ""}
            ${researchSummary.hidden_challenges?.length ? `
              <strong style="display: block; color: #db2777; margin-bottom: 8px; font-size: 10pt; text-transform: uppercase;">Hidden Challenges</strong>
              <ul style="margin: 0; padding-left: 20px; color: #2d3748;">
                ${researchSummary.hidden_challenges.map(c => `<li style="margin-bottom: 6px;">${c}</li>`).join("")}
              </ul>
            ` : ""}
          </div>
        ` : ""}

        ${researchSummary.stakeholders?.length
          ? `
          <div style="background: #f0fdf4; border: 2px solid #22c55e; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #166534; font-size: 14pt; margin: 0 0 15px 0; font-weight: 700;">Stakeholder Analysis</h3>
            <div style="display: block;">
              ${researchSummary.stakeholders.map(s => {
                if (typeof s === 'string') return `<div style="margin-bottom: 8px; color: #166534;">&bull; ${s}</div>`;
                return `
                  <div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #dcfce7;">
                    <strong style="color: #166534; display: block; font-size: 11pt;">${s.name}</strong>
                    <p style="margin: 4px 0; color: #3f6212; font-size: 10pt;"><strong>Incentive:</strong> ${s.incentive}</p>
                    <p style="margin: 0; color: #991b1b; font-size: 10pt;"><strong>Potential Conflict:</strong> ${s.conflict}</p>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        ` : ""}

        ${researchSummary.trends?.length
          ? `
          <div style="background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
            <h3 style="color: #0369a1; font-size: 14pt; margin: 0 0 15px 0; font-weight: 700;">Market Trends & Examples</h3>
            <ul style="margin: 0 0 15px 0; padding-left: 20px; color: #2d3748;">
              ${researchSummary.trends.map(t => `<li style="margin-bottom: 10px; line-height: 1.6;">${t}</li>`).join("")}
            </ul>
            ${researchSummary.examples?.length ? `
              <strong style="display: block; color: #0369a1; margin-bottom: 8px; font-size: 10pt; text-transform: uppercase;">Illustrative Examples</strong>
              <div style="color: #1e40af; font-size: 10pt; font-style: italic;">
                ${researchSummary.examples.map(e => `<div style="margin-bottom: 6px;">&bull; ${e}</div>`).join("")}
              </div>
            ` : ""}
          </div>
        `
          : ""}
      </div>
    `
    : "";

  const auditSection = audit
    ? `
      <div style="margin-top: 60px; page-break-before: always;">
        <div style="border-left: 5px solid #f5576c; padding-left: 20px; margin-bottom: 30px;">
          <h2 style="color: #1a202c; font-size: 28pt; margin: 0; font-weight: 800;">Editorial Audit</h2>
          <p style="color: #718096; font-size: 11pt; margin: 8px 0 0 0;">Professional quality assessment</p>
        </div>

        <div style="margin-bottom: 20px; background: white; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px;">
          <h3 style="margin: 0 0 12px 0; color: #1a202c; font-size: 13pt; font-weight: 700;">Sentiment & Tone Analysis</h3>
          <p style="margin: 0; color: #4a5568; line-height: 1.7; font-size: 11pt;">${audit.sentiment_tone}</p>
        </div>

        <div style="margin-bottom: 20px; background: white; border: 2px solid #e2e8f0; border-radius: 12px; padding: 25px;">
          <h3 style="margin: 0 0 12px 0; color: #1a202c; font-size: 13pt; font-weight: 700;">Entity Coverage</h3>
          <p style="margin: 0; color: #4a5568; line-height: 1.7; font-size: 11pt;">${audit.entity_coverage}</p>
        </div>

        <div style="background: #fffbeb; border: 2px solid #fbbf24; border-radius: 12px; padding: 25px;">
          <h3 style="margin: 0 0 12px 0; color: #92400e; font-size: 13pt; font-weight: 700;">SEO Recommendation</h3>
          <p style="margin: 0; color: #78350f; line-height: 1.7; font-size: 11pt; font-style: italic;">${audit.seo_recommendation}</p>
        </div>
      </div>
    `
    : "";

  const sourcesSection = sources?.length
    ? `
      <div style="margin-top: 60px; page-break-before: always;">
        <div style="border-left: 5px solid #10b981; padding-left: 20px; margin-bottom: 30px;">
          <h2 style="color: #1a202c; font-size: 28pt; margin: 0; font-weight: 800;">Source Citations</h2>
          <p style="color: #718096; font-size: 11pt; margin: 8px 0 0 0;">Verified references and research materials</p>
        </div>

        <div style="display: block;">
          ${sources
            .map(
              (s, i) => `
            <div style="background: white; border-left: 4px solid #10b981; border-top: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
              <h3 style="margin: 0 0 8px 0; color: #1a202c; font-size: 12pt; font-weight: 700; line-height: 1.4;">${i + 1}. ${s.title}</h3>
              <a href="${s.url}" style="color: #10b981; font-size: 9pt; text-decoration: none; display: block; margin-bottom: 10px;">${s.url}</a>
              <p style="margin: 0; color: #4a5568; font-size: 10pt; line-height: 1.6;">${s.description}</p>
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  const socialSection = socialKit
    ? `
      <div style="margin-top: 60px; page-break-before: always;">
        <div style="border-left: 5px solid #3b82f6; padding-left: 20px; margin-bottom: 30px;">
          <h2 style="color: #1a202c; font-size: 28pt; margin: 0; font-weight: 800;">Social Media Kit</h2>
          <p style="color: #718096; font-size: 11pt; margin: 8px 0 0 0;">Ready-to-publish content for all platforms</p>
        </div>

        <div style="display: block;">
          ${socialKit.twitter_thread
            ? `
            <div style="background: #f0f9ff; border: 2px solid #3b82f6; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; color: #1e40af; font-size: 13pt; font-weight: 700;">X (Twitter) Thread</h3>
              <div style="background: white; border-radius: 8px; padding: 18px; white-space: pre-wrap; font-size: 10pt; color: #1f2937; line-height: 1.6; border: 1px solid #bfdbfe;">${Array.isArray(socialKit.twitter_thread) ? socialKit.twitter_thread.join("\n\n") : socialKit.twitter_thread}</div>
            </div>
          `
            : ""}

          ${socialKit.linkedin_post
            ? `
            <div style="background: #eff6ff; border: 2px solid #0077b5; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; color: #0077b5; font-size: 13pt; font-weight: 700;">LinkedIn Post</h3>
              <div style="background: white; border-radius: 8px; padding: 18px; font-size: 10pt; color: #1f2937; line-height: 1.6; border: 1px solid #bfdbfe;">${socialKit.linkedin_post}</div>
            </div>
          `
            : ""}

          ${socialKit.newsletter_blurb
            ? `
            <div style="background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; color: #92400e; font-size: 13pt; font-weight: 700;">Newsletter Snippet</h3>
              <div style="background: white; border-radius: 8px; padding: 18px; font-size: 10pt; color: #1f2937; line-height: 1.6; border: 1px solid #fde68a;">${socialKit.newsletter_blurb}</div>
            </div>
          `
            : ""}

          ${socialKit.instagram_caption
            ? `
            <div style="background: #fdf4ff; border: 2px solid #e879f9; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; color: #a21caf; font-size: 13pt; font-weight: 700;">Instagram Caption</h3>
              <div style="background: white; border-radius: 8px; padding: 18px; font-size: 10pt; color: #1f2937; line-height: 1.6; border: 1px solid #f5d0fe;">${socialKit.instagram_caption}</div>
            </div>
          `
            : ""}

          ${socialKit.facebook_post
            ? `
            <div style="background: #eff6ff; border: 2px solid #1877f2; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
              <h3 style="margin: 0 0 15px 0; color: #1877f2; font-size: 13pt; font-weight: 700;">Facebook Post</h3>
              <div style="background: white; border-radius: 8px; padding: 18px; font-size: 10pt; color: #1f2937; line-height: 1.6; border: 1px solid #bfdbfe;">${socialKit.facebook_post}</div>
            </div>
          `
            : ""}
        </div>
      </div>
    `
    : "";

  return `
  <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <!--[if gte mso 9]>
    <xml>
      <w:WordDocument>
        <w:View>Print</w:View>
        <w:Zoom>100</w:Zoom>
        <w:DoNotOptimizeForBrowser/>
      </w:WordDocument>
    </xml>
    <![endif]-->
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
        max-width: 900px;
        margin: 0 auto;
        padding: 60px 40px;
        line-height: 1.7;
        color: #1f2937;
        background: #ffffff;
      }

      h1 { 
        font-size: 42pt; 
        margin-bottom: 16px; 
        color: #0f172a; 
        font-weight: 900; 
        line-height: 1.1;
        letter-spacing: -0.02em;
      }
      
      h2 { 
        font-size: 24pt; 
        margin-top: 50px; 
        margin-bottom: 20px; 
        font-weight: 800; 
        color: #1a202c;
        letter-spacing: -0.01em;
      }
      
      h3 { 
        font-size: 16pt; 
        margin-top: 30px; 
        margin-bottom: 12px; 
        font-weight: 700; 
        color: #2d3748;
      }

      p { 
        font-size: 11pt; 
        margin-bottom: 16pt; 
        color: #374151;
        line-height: 1.8;
      }
      
      ul, ol { 
        margin-bottom: 16pt; 
        padding-left: 24px; 
      }
      
      li { 
        font-size: 11pt; 
        margin-bottom: 8pt; 
        color: #374151;
        line-height: 1.7;
      }

      strong { 
        font-weight: 700; 
        color: #1f2937; 
      }
      
      blockquote { 
        border-left: 5px solid #667eea; 
        padding: 20px 25px; 
        color: #4a5568; 
        font-style: italic; 
        margin: 30px 0;
        background: #f7fafc;
        border-radius: 0 8px 8px 0;
        font-size: 12pt;
        line-height: 1.8;
      }

      a {
        color: #667eea;
        text-decoration: none;
        font-weight: 500;
      }

      hr {
        margin: 50px 0;
        border: none;
        border-top: 2px solid #e5e7eb;
      }

      .subtitle {
        font-size: 14pt;
        color: #6b7280;
        margin-bottom: 40px;
        line-height: 1.6;
        font-weight: 400;
      }

      .page-break { 
        page-break-before: always; 
      }

      @page {
        margin: 0;
      }

      @media print {
        body { 
          padding: 2cm;
          max-width: 100%;
        }
        
        .page-break { 
          page-break-before: always; 
        }
      }
    </style>
  </head>

  <body>

    <!-- COVER PAGE -->
    <div style="page-break-after: always; padding-top: 100px;">
      <div style="border-left: 6px solid #667eea; padding-left: 24px; margin-bottom: 30px;">
        <h1>${title}</h1>
        <p class="subtitle">A comprehensive analysis exploring key trends, opportunities, and strategic insights</p>
      </div>

      ${statsSection}
      ${imageSection}

      <div style="margin-top: 60px; padding: 25px; background: #f7fafc; background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); border-radius: 12px; border: 2px solid #e2e8f0;">
        <p style="font-size: 10pt; color: #4a5568; margin: 0; line-height: 1.6;">
          <strong style="color: #2d3748; display: block; margin-bottom: 8px; font-size: 11pt;">Report Information</strong>
          This document provides evidence-based insights, data-driven analysis, and strategic recommendations. All sources have been verified and cited throughout the report.
        </p>
      </div>
    </div>

    <!-- ARTICLE BODY -->
    <div>
      <div style="border-left: 5px solid #10b981; padding-left: 20px; margin-bottom: 30px;">
        <h2 style="margin-top: 0;">Executive Overview</h2>
      </div>

      <div style="font-size: 11pt; line-height: 1.8; color: #374151;">
        ${bodyContent}
      </div>
    </div>

    ${insightsSection}
    ${researchSection}
    ${sourcesSection}
    ${auditSection}
    ${socialSection}

    <!-- FOOTER -->
    <div style="margin-top: 80px; padding-top: 30px; border-top: 2px solid #e5e7eb; text-align: center;">
      <div style="display: inline-block; background: #667eea; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; border-radius: 8px; margin-bottom: 15px;">
        <p style="margin: 0; font-size: 11pt; font-weight: 700; letter-spacing: 0.5px;">GENERATED BY AUTODESKAI AI JOURNALIST</p>
      </div>
      <p style="color: #9ca3af; font-size: 9pt; margin: 0;">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>

  </body>
  </html>
  `;
};

export const handleExportPDF = (
  title: string, 
  bodyContent: string, 
  imageUrl?: string | null, 
  socialKit?: SocialKit | null,
  audit?: AuditReport | null,
  researchSummary?: ResearchSummary | null,
  sources?: Array<{ title: string; url: string; description: string }> | null,
  stats?: { words: number; readingTime: number } | null,
  dataInsights?: Array<{ label: string; value: number; context: string }> | null
) => {
  if (typeof window === 'undefined') return;
  const fullHTML = buildExportHTML(title, bodyContent, imageUrl, socialKit, audit, researchSummary, sources, stats, dataInsights);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.write(fullHTML);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  }
};

export const handleExportWord = (
  title: string, 
  bodyContent: string, 
  imageUrl?: string | null, 
  socialKit?: SocialKit | null,
  audit?: AuditReport | null,
  researchSummary?: ResearchSummary | null,
  sources?: Array<{ title: string; url: string; description: string }> | null,
  stats?: { words: number; readingTime: number } | null,
  dataInsights?: Array<{ label: string; value: number; context: string }> | null
) => {
  if (typeof window === 'undefined') return;
  const wordHTML = buildExportHTML(title, bodyContent, imageUrl, socialKit, audit, researchSummary, sources, stats, dataInsights);
  const blob = new Blob(['\ufeff', wordHTML], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title.replace(/\s+/g, '_')}_Full_Report.doc`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const handleDownloadImage = (imageUrl: string, title: string) => {
  if (!imageUrl) return;
  const link = document.createElement('a');
  link.href = imageUrl;
  link.download = `cover_${title.replace(/\s+/g, '_')}.jpg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};