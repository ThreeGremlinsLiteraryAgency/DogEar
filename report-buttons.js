/*
  DogEar
  report-buttons.js

  Reusable reporting controls for:
    profile.html
    club.html
    discussion.html

  Add this near the bottom of each page:

  <script src="report-buttons.js"></script>

  The script reads the current page URL and builds the correct
  report.html link automatically.
*/

(function () {

  const path =
    location.pathname
      .split("/")
      .pop()
      .toLowerCase();

  const params =
    new URLSearchParams(
      location.search
    );

  /* =========================================================
     STYLES
  ========================================================= */

  function installStyles(){

    if(
      document.getElementById(
        "dogear-report-button-styles"
      )
    )
      return;

    const style =
      document.createElement("style");

    style.id =
      "dogear-report-button-styles";

    style.textContent = `
      .dogear-report-button{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        min-height:36px;
        padding:0 12px;
        border:1px solid rgba(199,155,89,.22);
        border-radius:999px;
        background:transparent;
        color:#aaa18f;
        text-decoration:none;
        cursor:pointer;
        font:800 8px Arial,sans-serif;
        letter-spacing:.08em;
        text-transform:uppercase;
        transition:.18s ease;
      }

      .dogear-report-button:hover{
        border-color:rgba(230,160,154,.55);
        color:#e6a09a;
      }

      .dogear-report-menu{
        position:relative;
        display:inline-flex;
      }

      .dogear-report-menu-panel{
        display:none;
        position:absolute;
        right:0;
        top:calc(100% + 8px);
        min-width:170px;
        padding:7px;
        z-index:50;
        border:1px solid rgba(199,155,89,.22);
        border-radius:12px;
        background:#101410;
        box-shadow:0 15px 45px rgba(0,0,0,.45);
      }

      .dogear-report-menu-panel.show{
        display:block;
      }

      .dogear-report-menu-panel a{
        display:block;
        padding:9px 10px;
        border-radius:8px;
        color:#aaa18f;
        text-decoration:none;
        font:800 9px Arial,sans-serif;
        text-transform:uppercase;
        letter-spacing:.06em;
      }

      .dogear-report-menu-panel a:hover{
        background:rgba(199,155,89,.08);
        color:#dfbd7e;
      }
    `;

    document.head.appendChild(
      style
    );

  }

  /* =========================================================
     URL HELPERS
  ========================================================= */

  function localReturn(){

    return (
      path +
      location.search
    );

  }

  function reportUrl({
    type,
    target,
    user,
    club,
    discussion
  }){

    const search =
      new URLSearchParams();

    if(type)
      search.set(
        "type",
        type
      );

    if(target)
      search.set(
        "target",
        target
      );

    if(user)
      search.set(
        "user",
        user
      );

    if(club)
      search.set(
        "club",
        club
      );

    if(discussion)
      search.set(
        "discussion",
        discussion
      );

    search.set(
      "return",
      encodeURIComponent(
        localReturn()
      )
    );

    return (
      "report.html?" +
      search.toString()
    );

  }

  /* =========================================================
     BUTTON
  ========================================================= */

  function makeButton(
    url,
    label="Report"
  ){

    const anchor =
      document.createElement("a");

    anchor.className =
      "dogear-report-button";

    anchor.href =
      url;

    anchor.textContent =
      label;

    return anchor;

  }

  /* =========================================================
     INSERTION TARGET
  ========================================================= */

  function insertButton(button){

    /*
      Preferred:
      Add this wherever you want the button on a page:

        <div id="reportAction"></div>

      If that doesn't exist, the script tries a few common
      action/button containers and finally falls back to main.
    */

    const explicit =
      document.getElementById(
        "reportAction"
      );

    if(explicit){

      explicit.appendChild(
        button
      );

      return;

    }

    const fallback =
      document.querySelector(
        ".profile-actions, " +
        ".club-actions, " +
        ".discussion-actions, " +
        ".post-actions, " +
        ".actions"
      );

    if(fallback){

      fallback.appendChild(
        button
      );

      return;

    }

    const main =
      document.querySelector(
        "main"
      );

    if(main){

      const holder =
        document.createElement("div");

      holder.style.marginTop =
        "18px";

      holder.appendChild(
        button
      );

      main.appendChild(
        holder
      );

    }

  }

  /* =========================================================
     PROFILE
  ========================================================= */

  function setupProfile(){

    const userId =
      params.get("id");

    /*
      No report button for a profile without a user ID.
      This also keeps the current user's generic profile route
      from accidentally becoming reportable without a target.
    */

    if(!userId)
      return;

    const url =
      reportUrl({
        type:"user",
        target:userId
      });

    insertButton(
      makeButton(
        url,
        "Report Profile"
      )
    );

  }

  /* =========================================================
     CLUB
  ========================================================= */

  function setupClub(){

    const clubId =
      params.get("id");

    if(!clubId)
      return;

    const url =
      reportUrl({
        type:"club",
        target:clubId,
        club:clubId
      });

    insertButton(
      makeButton(
        url,
        "Report Club"
      )
    );

  }

  /* =========================================================
     DISCUSSION
  ========================================================= */

  function setupDiscussion(){

    const discussionId =
      params.get("id");

    const clubId =
      params.get("club");

    if(!discussionId)
      return;

    const url =
      reportUrl({
        type:"discussion",
        target:discussionId,
        club:clubId
      });

    insertButton(
      makeButton(
        url,
        "Report Discussion"
      )
    );

    /*
      Reply report buttons.

      To make any rendered reply reportable, give its wrapper:

        data-reply-id="REPLY_ID"
        data-author-id="AUTHOR_ID"

      Example:

        <article
          class="reply"
          data-reply-id="abc123"
          data-author-id="user456">

      The script will automatically append a Report button.
    */

    document
      .querySelectorAll(
        "[data-reply-id]"
      )
      .forEach(
        reply => {

          const replyId =
            reply.dataset.replyId;

          const userId =
            reply.dataset.authorId ||
            "";

          if(!replyId)
            return;

          if(
            reply.querySelector(
              ".dogear-reply-report"
            )
          )
            return;

          const replyUrl =
            reportUrl({
              type:"reply",
              target:replyId,
              user:userId,
              club:clubId,
              discussion:discussionId
            });

          const button =
            makeButton(
              replyUrl,
              "Report"
            );

          button.classList.add(
            "dogear-reply-report"
          );

          const actions =
            reply.querySelector(
              ".reply-actions, .actions"
            );

          if(actions){

            actions.appendChild(
              button
            );

          }
          else{

            const holder =
              document.createElement(
                "div"
              );

            holder.style.marginTop =
              "10px";

            holder.appendChild(
              button
            );

            reply.appendChild(
              holder
            );

          }

        }
      );

  }

  /* =========================================================
     START
  ========================================================= */

  function start(){

    installStyles();

    if(path === "profile.html"){

      setupProfile();

      return;

    }

    if(path === "club.html"){

      setupClub();

      return;

    }

    if(path === "discussion.html"){

      setupDiscussion();

    }

  }

  if(
    document.readyState ===
    "loading"
  ){

    document.addEventListener(
      "DOMContentLoaded",
      start
    );

  }
  else{

    start();

  }

})();
