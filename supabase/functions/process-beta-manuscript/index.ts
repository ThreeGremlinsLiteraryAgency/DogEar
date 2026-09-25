import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import {
  createClient
} from "jsr:@supabase/supabase-js@2";

import JSZip from "npm:jszip@3.10.1";
import { DOMParser } from "npm:@xmldom/xmldom@0.8.10";


/* =========================================================
   PAPER GREMLIN BETA MANUSCRIPT PROCESSOR

   Supported:
   - TXT
   - Markdown
   - Microsoft Word DOCX

   The original manuscript remains in the private
   beta-manuscripts Storage bucket.

   Readers receive only processed text stored in
   beta_manuscript_sections.
========================================================= */


interface ProcessRequest {
  manuscript_id: string;
}


interface ParsedSection {
  section_number: number;
  title: string;
  content_text: string;
  word_count: number;
}


/* =========================================================
   CORS
========================================================= */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",

  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",

  "Access-Control-Allow-Methods":
    "POST, OPTIONS",
};


/* =========================================================
   JSON RESPONSE
========================================================= */

function jsonResponse(
  body: Record<string, unknown>,
  status = 200
) {

  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        ...corsHeaders,

        "Content-Type":
          "application/json",
      },
    }
  );

}


/* =========================================================
   WORD COUNT
========================================================= */

function countWords(
  text: string
): number {

  const cleaned =
    text.trim();


  if(!cleaned){
    return 0;
  }


  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .length;

}


/* =========================================================
   NORMALIZE TEXT
========================================================= */

function normalizeText(
  text: string
): string {

  return String(
    text || ""
  )

    .replace(
      /\r\n/g,
      "\n"
    )

    .replace(
      /\r/g,
      "\n"
    )

    .replace(
      /\u0000/g,
      ""
    )

    .replace(
      /[ \t]+\n/g,
      "\n"
    )

    .replace(
      /\n{4,}/g,
      "\n\n\n"
    )

    .trim();

}


/* =========================================================
   HEADING CLEANUP
========================================================= */

function cleanHeading(
  heading: string
): string {

  return heading

    .replace(
      /^#{1,6}\s*/,
      ""
    )

    .trim();

}


/* =========================================================
   HEADING DETECTION
========================================================= */

function looksLikeHeading(
  line: string
): boolean {

  const value =
    line.trim();


  if(!value){
    return false;
  }


  /*
    Markdown / converted Word heading:

      # Chapter 1
      ## Prologue
  */

  if(
    /^#{1,6}\s+\S/.test(
      value
    )
  ){
    return true;
  }


  /*
    Common manuscript headings:

      Chapter 1
      Chapter One
      Chapter 12: The Door
      Part II
      Book Three
      Prologue
      Epilogue
      Introduction
      Preface
      Foreword
      Afterword
  */

  return /^(?:(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+|[a-z]+)(?:\s*[:\-–—]\s*.*)?|prologue(?:\s*[:\-–—]\s*.*)?|epilogue(?:\s*[:\-–—]\s*.*)?|introduction(?:\s*[:\-–—]\s*.*)?|preface(?:\s*[:\-–—]\s*.*)?|foreword(?:\s*[:\-–—]\s*.*)?|afterword(?:\s*[:\-–—]\s*.*)?)$/i
    .test(
      value
    );

}


/* =========================================================
   SPLIT LARGE SECTIONS
========================================================= */

function splitLargeSection(
  title: string,
  content: string,
  maxCharacters = 50000
): ParsedSection[] {

  const normalized =
    normalizeText(
      content
    );


  if(!normalized){
    return [];
  }


  if(
    normalized.length <=
      maxCharacters
  ){

    return [
      {
        section_number:0,

        title,

        content_text:
          normalized,

        word_count:
          countWords(
            normalized
          ),
      }
    ];

  }


  const paragraphs =
    normalized.split(
      /\n\s*\n/
    );


  const chunks:
    ParsedSection[] = [];


  let current =
    "";


  let part =
    1;


  for(
    const paragraph
    of paragraphs
  ){

    const cleaned =
      paragraph.trim();


    if(!cleaned){
      continue;
    }


    const candidate =
      current
        ? current +
          "\n\n" +
          cleaned
        : cleaned;


    if(
      candidate.length >
        maxCharacters &&
      current
    ){

      chunks.push({
        section_number:0,

        title:
          `${title} — Part ${part}`,

        content_text:
          current,

        word_count:
          countWords(
            current
          ),
      });


      part += 1;

      current =
        cleaned;

    }
    else{

      current =
        candidate;

    }

  }


  if(current){

    chunks.push({
      section_number:0,

      title:
        chunks.length
          ? `${title} — Part ${part}`
          : title,

      content_text:
        current,

      word_count:
        countWords(
          current
        ),
    });

  }


  return chunks;

}


/* =========================================================
   PARSE MANUSCRIPT INTO READER SECTIONS
========================================================= */

function parseSections(
  rawText: string
): ParsedSection[] {

  const text =
    normalizeText(
      rawText
    );


  if(!text){
    return [];
  }


  const lines =
    text.split("\n");


  const headings: {
    lineIndex:number;
    title:string;
  }[] = [];


  for(
    let i = 0;
    i < lines.length;
    i++
  ){

    if(
      looksLikeHeading(
        lines[i]
      )
    ){

      headings.push({
        lineIndex:i,

        title:
          cleanHeading(
            lines[i]
          ),
      });

    }

  }


  /*
    No recognizable chapter headings.

    Keep the manuscript as one reader section unless
    it is unusually large.
  */

  if(
    !headings.length
  ){

    const sections =
      splitLargeSection(
        "Manuscript",
        text
      );


    return sections.map(
      (
        section,
        index
      ) => ({
        ...section,

        section_number:
          index + 1,
      })
    );

  }


  const sections:
    ParsedSection[] = [];


  /*
    Preserve material before first chapter.
  */

  const firstHeading =
    headings[0];


  const frontMatter =
    lines
      .slice(
        0,
        firstHeading.lineIndex
      )
      .join("\n")
      .trim();


  if(frontMatter){

    const pieces =
      splitLargeSection(
        "Front Matter",
        frontMatter
      );


    sections.push(
      ...pieces
    );

  }


  /*
    Create reader sections from headings.
  */

  for(
    let i = 0;
    i < headings.length;
    i++
  ){

    const heading =
      headings[i];


    const nextHeading =
      headings[i + 1];


    const start =
      heading.lineIndex +
      1;


    const end =
      nextHeading
        ? nextHeading.lineIndex
        : lines.length;


    const body =
      lines
        .slice(
          start,
          end
        )
        .join("\n")
        .trim();


    const sectionContent =
      body ||
      heading.title;


    const pieces =
      splitLargeSection(
        heading.title,
        sectionContent
      );


    sections.push(
      ...pieces
    );

  }


  return sections.map(
    (
      section,
      index
    ) => ({
      ...section,

      section_number:
        index + 1,
    })
  );

}


/* =========================================================
   SUPPORTED FILE CHECK
========================================================= */

function isSupportedFile(
  filename: string,
  mimeType: string | null
): boolean {

  const name =
    String(
      filename || ""
    )
      .toLowerCase();


  const mime =
    String(
      mimeType || ""
    )
      .toLowerCase();


  return (
    name.endsWith(".txt") ||

    name.endsWith(".md") ||

    name.endsWith(
      ".markdown"
    ) ||

    name.endsWith(".docx") ||

    mime ===
      "text/plain" ||

    mime ===
      "text/markdown" ||

    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

}


/* =========================================================
   DOCX CHECK
========================================================= */

function isDocxFile(
  filename: string,
  mimeType: string | null
): boolean {

  const name =
    String(
      filename || ""
    )
      .toLowerCase();


  const mime =
    String(
      mimeType || ""
    )
      .toLowerCase();


  return (
    name.endsWith(".docx") ||

    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );

}


/* =========================================================
   WORD XML ATTRIBUTE
========================================================= */

function getWordAttribute(
  element: Element,
  name: string
): string {

  return (
    element.getAttribute(
      `w:${name}`
    ) ||

    element.getAttribute(
      name
    ) ||

    ""
  );

}


/* =========================================================
   WORD PARAGRAPH STYLE
========================================================= */

function getParagraphStyleId(
  paragraph: Element
): string {

  const children =
    Array.from(
      paragraph.childNodes
    ).filter(
      (node): node is Element =>
        node.nodeType === 1
    );


  const paragraphProperties =
    children.find(
      child =>
        child.localName ===
        "pPr"
    );


  if(
    !paragraphProperties
  ){
    return "";
  }


  const propertyChildren =
    Array.from(
      paragraphProperties.childNodes
    ).filter(
      (node): node is Element =>
        node.nodeType === 1
    );


  const styleElement =
    propertyChildren.find(
      child =>
        child.localName ===
        "pStyle"
    );


  if(
    !styleElement
  ){
    return "";
  }


  return getWordAttribute(
    styleElement,
    "val"
  );

}


/* =========================================================
   EXTRACT TEXT FROM WORD XML NODE

   Handles:
   - normal text
   - tabs
   - line breaks
   - multiple Word runs inside a paragraph
========================================================= */

function extractWordNodeText(
  node: Node
): string {

  /*
    TEXT_NODE = 3
  */

  if(
    node.nodeType === 3
  ){

    return (
      node.nodeValue ||
      ""
    );

  }


  /*
    ELEMENT_NODE = 1
  */

  if(
    node.nodeType !== 1
  ){

    return "";

  }


  const element =
    node as Element;


  if(
    element.localName ===
    "tab"
  ){

    return "\t";

  }


  if(
    element.localName ===
      "br" ||

    element.localName ===
      "cr"
  ){

    return "\n";

  }


  let value =
    "";


  for(
    const child
    of Array.from(
      element.childNodes
    )
  ){

    value +=
      extractWordNodeText(
        child
      );

  }


  return value;

}


/* =========================================================
   WORD HEADING STYLE DETECTION
========================================================= */

function styleLooksLikeHeading(
  styleId: string
): boolean {

  const value =
    String(
      styleId || ""
    )
      .trim()
      .toLowerCase()
      .replace(
        /[\s_-]+/g,
        ""
      );


  return (
    /^heading[1-6]$/.test(
      value
    ) ||

    /^title[1-6]$/.test(
      value
    ) ||

    value ===
      "chapter" ||

    value ===
      "chaptertitle" ||

    value ===
      "chapterheading"
  );

}


/* =========================================================
   EXTRACT DOCX

   DOCX files are ZIP archives.

   We open word/document.xml and extract the manuscript's
   paragraph text.

   Word heading styles are converted to "# Heading" so the
   existing Paper Gremlin chapter parser can recognize them.
========================================================= */

async function extractDocxText(
  fileBlob: Blob
): Promise<string> {

  const buffer =
    await fileBlob
      .arrayBuffer();


  let zip;


  try{

    zip =
      await JSZip.loadAsync(
        buffer
      );

  }
  catch{

    throw new Error(
      "Paper Gremlin could not open this Word document. The DOCX file may be damaged."
    );

  }


  const documentFile =
    zip.file(
      "word/document.xml"
    );


  if(
    !documentFile
  ){

    throw new Error(
      "This Word document does not contain a readable document body."
    );

  }


  const documentXml =
    await documentFile.async(
      "string"
    );


  const xml =
    new DOMParser()
      .parseFromString(
        documentXml,
        "application/xml"
      );


  if(
    !xml
  ){

    throw new Error(
      "Paper Gremlin could not read the Word document."
    );

  }


  const parserErrors =
    xml.getElementsByTagName(
      "parsererror"
    );


  if(
    parserErrors.length
  ){

    throw new Error(
      "The Word document appears to be damaged or unreadable."
    );

  }


  /*
    Get all Word paragraphs regardless of namespace prefix.
  */

  const paragraphs =
    Array.from(
      xml.getElementsByTagNameNS(
        "*",
        "p"
      )
    );


  const output:
    string[] = [];


  for(
    const paragraph
    of paragraphs
  ){

    const paragraphText =
      extractWordNodeText(
        paragraph
      )

        .replace(
          /\u00a0/g,
          " "
        )

        .trim();


    if(
      !paragraphText
    ){
      continue;
    }


    const styleId =
      getParagraphStyleId(
        paragraph
      );


    /*
      If Word says this paragraph is a heading but its text
      isn't already recognizable as something like
      "Chapter 4", turn it into a Markdown-style heading.

      The normal Paper Gremlin parser will then treat it as a
      section boundary.
    */

    if(
      styleLooksLikeHeading(
        styleId
      ) &&

      !looksLikeHeading(
        paragraphText
      )
    ){

      output.push(
        `# ${paragraphText}`
      );

    }
    else{

      output.push(
        paragraphText
      );

    }

  }


  const extracted =
    normalizeText(
      output.join(
        "\n\n"
      )
    );


  if(
    !extracted
  ){

    throw new Error(
      "The Word document did not contain readable manuscript text."
    );

  }


  return extracted;

}


/* =========================================================
   EXTRACT MANUSCRIPT TEXT
========================================================= */

async function extractManuscriptText(
  fileBlob: Blob,
  filename: string,
  mimeType: string | null
): Promise<string> {

  if(
    isDocxFile(
      filename,
      mimeType
    )
  ){

    return await extractDocxText(
      fileBlob
    );

  }


  /*
    TXT and Markdown can be read directly.
  */

  return await fileBlob.text();

}


/* =========================================================
   ORIGINAL FORMAT
========================================================= */

function getOriginalFormat(
  filename: string,
  mimeType: string | null
): string {

  if(
    isDocxFile(
      filename,
      mimeType
    )
  ){

    return "docx";

  }


  const name =
    String(
      filename || ""
    )
      .toLowerCase();


  if(
    name.endsWith(".md") ||
    name.endsWith(".markdown")
  ){

    return "markdown";

  }


  return "text";

}


/* =========================================================
   EDGE FUNCTION
========================================================= */

Deno.serve(
  async (
    req: Request
  ) => {

    /*
      Browser CORS preflight.
    */

    if(
      req.method ===
      "OPTIONS"
    ){

      return new Response(
        "ok",
        {
          status:200,

          headers:
            corsHeaders,
        }
      );

    }


    if(
      req.method !==
      "POST"
    ){

      return jsonResponse(
        {
          success:false,

          error:
            "Method not allowed.",
        },
        405
      );

    }


    /* =====================================================
       SUPABASE CONFIGURATION
    ===================================================== */

    const supabaseUrl =
      Deno.env.get(
        "SUPABASE_URL"
      );


    const supabaseAnonKey =
      Deno.env.get(
        "SUPABASE_ANON_KEY"
      );


    if(
      !supabaseUrl ||
      !supabaseAnonKey
    ){

      console.error(
        "Missing SUPABASE_URL or SUPABASE_ANON_KEY."
      );


      return jsonResponse(
        {
          success:false,

          error:
            "The manuscript processor is not configured correctly.",
        },
        500
      );

    }


    /* =====================================================
       AUTHORIZATION HEADER
    ===================================================== */

    const authHeader =
      req.headers.get(
        "Authorization"
      );


    if(
      !authHeader ||

      !authHeader
        .toLowerCase()
        .startsWith(
          "bearer "
        )
    ){

      return jsonResponse(
        {
          success:false,

          error:
            "Authentication required.",
        },
        401
      );

    }


    /*
      Operate as the logged-in Paper Gremlin user.

      We intentionally do NOT use the service-role key.
      RLS and private Storage policies remain in effect.
    */

    const supabase =
      createClient(
        supabaseUrl,
        supabaseAnonKey,
        {
          global:{
            headers:{
              Authorization:
                authHeader,
            },
          },

          auth:{
            persistSession:false,
            autoRefreshToken:false,
          },
        }
      );


    /* =====================================================
       VERIFY USER
    ===================================================== */

    const {
      data:userData,
      error:userError
    } =
      await supabase
        .auth
        .getUser();


    const user =
      userData?.user ||
      null;


    if(
      userError ||
      !user
    ){

      console.error(
        "Beta processor authentication:",
        userError
      );


      return jsonResponse(
        {
          success:false,

          error:
            "Your Paper Gremlin session could not be verified. Please sign in again.",
        },
        401
      );

    }


    /* =====================================================
       REQUEST BODY
    ===================================================== */

    let payload:
      ProcessRequest;


    try{

      payload =
        await req.json();

    }
    catch{

      return jsonResponse(
        {
          success:false,

          error:
            "Invalid JSON body.",
        },
        400
      );

    }


    const manuscriptId =
      payload?.manuscript_id;


    if(
      !manuscriptId ||

      typeof manuscriptId !==
        "string"
    ){

      return jsonResponse(
        {
          success:false,

          error:
            "manuscript_id is required.",
        },
        400
      );

    }


    /* =====================================================
       LOAD MANUSCRIPT METADATA
    ===================================================== */

    const {
      data:manuscript,
      error:manuscriptError
    } =
      await supabase
        .from(
          "beta_manuscripts"
        )
        .select(`
          id,
          project_id,
          round_id,
          uploaded_by,
          original_filename,
          storage_path,
          mime_type,
          active,
          version_number,
          processing_status
        `)
        .eq(
          "id",
          manuscriptId
        )
        .maybeSingle();


    if(
      manuscriptError ||
      !manuscript
    ){

      console.error(
        "Load manuscript:",
        manuscriptError
      );


      return jsonResponse(
        {
          success:false,

          error:
            "Manuscript not found or access denied.",
        },
        404
      );

    }


    /* =====================================================
       LOAD PROJECT + VERIFY OWNERSHIP
    ===================================================== */

    const {
      data:project,
      error:projectError
    } =
      await supabase
        .from(
          "beta_projects"
        )
        .select(
          "id, owner_id"
        )
        .eq(
          "id",
          manuscript.project_id
        )
        .maybeSingle();


    if(
      projectError ||
      !project
    ){

      console.error(
        "Load beta project:",
        projectError
      );


      return jsonResponse(
        {
          success:false,

          error:
            "Beta project not found or access denied.",
        },
        404
      );

    }


    /*
      Both conditions must be true:

      1. Logged-in user owns the beta project.
      2. Same user uploaded this manuscript.
    */

    if(
      project.owner_id !==
        user.id ||

      manuscript.uploaded_by !==
        user.id
    ){

      return jsonResponse(
        {
          success:false,

          error:
            "Only the project owner may process this manuscript.",
        },
        403
      );

    }


    /* =====================================================
       VERIFY FILE FORMAT
    ===================================================== */

    if(
      !isSupportedFile(
        manuscript.original_filename,
        manuscript.mime_type
      )
    ){

      const unsupportedMessage =
        "Paper Gremlin supports TXT, Markdown, and Microsoft Word DOCX manuscripts.";


      const {
        error:updateError
      } =
        await supabase
          .from(
            "beta_manuscripts"
          )
          .update({

            processing_status:
              "failed",

            processing_error:
              unsupportedMessage,

            processed_at:
              new Date()
                .toISOString(),

          })
          .eq(
            "id",
            manuscriptId
          );


      if(
        updateError
      ){

        console.warn(
          "Could not record unsupported format:",
          updateError
        );

      }


      return jsonResponse(
        {
          success:false,

          error:
            unsupportedMessage,
        },
        415
      );

    }


    /* =====================================================
       REQUEST PROCESSING

       Existing Paper Gremlin RPC.
    ===================================================== */

    const {
      error:requestError
    } =
      await supabase
        .rpc(
          "request_beta_manuscript_processing",
          {
            p_manuscript_id:
              manuscriptId,
          }
        );


    if(
      requestError
    ){

      console.error(
        "Request manuscript processing:",
        requestError
      );


      return jsonResponse(
        {
          success:false,

          error:
            requestError.message,
        },
        400
      );

    }


    /* =====================================================
       MARK PROCESSING STARTED
    ===================================================== */

    const {
      error:processingError
    } =
      await supabase
        .from(
          "beta_manuscripts"
        )
        .update({

          processing_status:
            "processing",

          processing_error:
            null,

          processing_started_at:
            new Date()
              .toISOString(),

          processed_at:
            null,

        })
        .eq(
          "id",
          manuscriptId
        );


    if(
      processingError
    ){

      console.error(
        "Mark manuscript processing:",
        processingError
      );


      return jsonResponse(
        {
          success:false,

          error:
            processingError.message,
        },
        500
      );

    }


    /*
      From this point onward, a processing exception must
      mark the manuscript failed.
    */

    try{


      /* ===================================================
         DOWNLOAD ORIGINAL PRIVATE MANUSCRIPT
      =================================================== */

      const {
        data:fileBlob,
        error:downloadError
      } =
        await supabase
          .storage
          .from(
            "beta-manuscripts"
          )
          .download(
            manuscript.storage_path
          );


      if(
        downloadError ||
        !fileBlob
      ){

        console.error(
          "Private manuscript download:",
          downloadError
        );


        throw new Error(
          downloadError?.message ||
          "Paper Gremlin could not retrieve the private manuscript."
        );

      }


      /* ===================================================
         EXTRACT TEXT

         TXT / Markdown:
           Browser-compatible text extraction.

         DOCX:
           Open ZIP container and parse word/document.xml.
      =================================================== */

      const rawText =
        await extractManuscriptText(
          fileBlob,
          manuscript.original_filename,
          manuscript.mime_type
        );


      const normalized =
        normalizeText(
          rawText
        );


      if(
        !normalized
      ){

        throw new Error(
          "The manuscript did not contain readable text."
        );

      }


      /* ===================================================
         PARSE INTO READER SECTIONS
      =================================================== */

      const sections =
        parseSections(
          normalized
        );


      if(
        !sections.length
      ){

        throw new Error(
          "Paper Gremlin could not create any readable manuscript sections."
        );

      }


      /*
        Reprocessing must not duplicate sections.

        Delete the old processed representation.
        The original private file remains untouched.
      */

      const {
        error:deleteError
      } =
        await supabase
          .from(
            "beta_manuscript_sections"
          )
          .delete()
          .eq(
            "manuscript_id",
            manuscriptId
          );


      if(
        deleteError
      ){

        console.error(
          "Delete previous manuscript sections:",
          deleteError
        );


        throw deleteError;

      }


      /* ===================================================
         PREPARE SECTION ROWS
      =================================================== */

      const rows =
        sections.map(
          section => ({

            manuscript_id:
              manuscriptId,

            section_number:
              section.section_number,

            title:
              section.title,

            content_text:
              section.content_text,

            word_count:
              section.word_count,

          })
        );


      /*
        Insert sections in batches.
      */

      const batchSize =
        20;


      for(
        let start = 0;
        start < rows.length;
        start += batchSize
      ){

        const batch =
          rows.slice(
            start,
            start + batchSize
          );


        const {
          error:insertError
        } =
          await supabase
            .from(
              "beta_manuscript_sections"
            )
            .insert(
              batch
            );


        if(
          insertError
        ){

          console.error(
            "Insert manuscript sections:",
            insertError
          );


          throw insertError;

        }

      }


      /* ===================================================
         FINAL MANUSCRIPT METRICS
      =================================================== */

      const totalWords =
        sections.reduce(
          (
            total,
            section
          ) =>
            total +
            section.word_count,
          0
        );


      const totalCharacters =
        normalized.length;


      const originalFormat =
        getOriginalFormat(
          manuscript.original_filename,
          manuscript.mime_type
        );


      /* ===================================================
         MARK MANUSCRIPT READY
      =================================================== */

      const {
        error:readyError
      } =
        await supabase
          .from(
            "beta_manuscripts"
          )
          .update({

            processing_status:
              "ready",

            processing_error:
              null,

            processed_at:
              new Date()
                .toISOString(),

            extracted_character_count:
              totalCharacters,

            chapter_count:
              sections.length,

            word_count:
              totalWords,

            processing_metadata:{

              parser:
                originalFormat ===
                  "docx"
                    ? "dogear-docx-v3"
                    : "dogear-text-v3",

              section_count:
                sections.length,

              original_format:
                originalFormat,

              processed_by:
                "process-beta-manuscript",

              processing_version:
                3,
            },

          })
          .eq(
            "id",
            manuscriptId
          );


      if(
        readyError
      ){

        console.error(
          "Mark manuscript ready:",
          readyError
        );


        throw readyError;

      }


      /* ===================================================
         SUCCESS
      =================================================== */

      console.log(
        "Paper Gremlin manuscript processing complete",
        {
          manuscript_id:
            manuscriptId,

          user_id:
            user.id,

          format:
            originalFormat,

          sections:
            sections.length,

          words:
            totalWords,

          characters:
            totalCharacters,
        }
      );


      return jsonResponse(
        {
          success:true,

          manuscript_id:
            manuscriptId,

          processing_status:
            "ready",

          format:
            originalFormat,

          sections:
            sections.length,

          word_count:
            totalWords,

          characters:
            totalCharacters,
        },
        200
      );

    }
    catch(error){


      /* ===================================================
         PROCESSING FAILURE
      =================================================== */

      console.error(
        "Beta manuscript processing failed:",
        error
      );


      const message =
        error instanceof Error
          ? error.message
          : "Unknown manuscript processing error.";


      /*
        Prevent failed manuscripts from remaining stuck
        on "processing".
      */

      const {
        error:failureUpdateError
      } =
        await supabase
          .from(
            "beta_manuscripts"
          )
          .update({

            processing_status:
              "failed",

            processing_error:
              message,

            processed_at:
              new Date()
                .toISOString(),

          })
          .eq(
            "id",
            manuscriptId
          );


      if(
        failureUpdateError
      ){

        console.error(
          "Could not record manuscript processing failure:",
          failureUpdateError
        );

      }


      return jsonResponse(
        {
          success:false,

          manuscript_id:
            manuscriptId,

          processing_status:
            "failed",

          error:
            message,
        },
        500
      );

    }

  }
);
