const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

let database = null;
const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: path.join(__dirname, "twitterClone.db"),
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running on http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const getFollowingPeopleIdsUser = async (username) => {
  const getTheFollowingPeopleQuery = `
        SELECT 
            following_user_id FROM follower
        INNER JOIN user ON user.user_id = follower.follower_user_id
        WHERE user.username = '${username}';
    `;

  const followingPeople = await database.all(getTheFollowingPeopleQuery);
  const arrayOfIDs = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );

  return arrayOfIDs;
};

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `
    SELECT
    *
    FROM 
    tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';
    `;
  const tweet = await database.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//Register User API 1

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  //scenario 1
  if (dbUser === undefined) {
    //scenario 2
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      //scenario 3
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
                INSERT INTO 
                    user(name,username,password,gender)
                VALUES
                    (
                        '${name}',
                        '${username}',
                        '${hashedPassword}',
                        '${gender}'
                    );
            `;
      await database.run(createUserQuery);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

//USER-LOGIN API-2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await database.get(selectUserQuery);
  //scenario 1
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
      const payload = { username, userId: dbUser.user_id };
      if (isPasswordMatched === true) {
        const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
        response.send({ jwtToken });
      } else {
        //scenario 2
        response.status(400);
        response.send("Invalid password");
      }
    }
  }
});

//API - 3
app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsUser(username);

  const getTweetsQuery = `
        SELECT 
            username,tweet,date_time AS dateTime 
        FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
        WHERE 
            user.user_id IN (${followingPeopleIds})
        ORDER BY date_time DESC
        LIMIT 4;
    `;
  const tweets = await database.all(getTweetsQuery);
  response.send(tweets);
});

//API-4

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUsersQuery = `SELECT name FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    WHERE follower_user_id = '${userId}';
    `;
  const followingPeople = await database.all(getFollowingUsersQuery);
  response.send(followingPeople);
});

//API-5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowersQuery = `SELECT DISTINCT name FROM follower
        INNER JOIN user ON user.user_id = follower.follower_user_id
        WHERE following_user_id = '${userId}';`;
  const followers = await database.all(getFollowersQuery);
  response.send(followers);
});

//API-6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT tweet,
        (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}')AS likes,
        (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}')AS replies,
        date_time AS dateTime
        FROM tweet
        WHERE tweet.tweet_id = '${tweetId}';
        `;
    const tweet = await database.get(getTweetQuery);
    response.send(tweet);
  }
);

//API -7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
        SELECT username FROM user INNER JOIN like
        ON user.user_id = like.user_id 
        WHERE tweet_id = '${tweetId}';
    `;
    const likedUsers = await database.all(getLikesQuery);
    const usersArray = likedUsers.map((eachUser) => eachUser.username);
    response.send({ likes: usersArray });
  }
);

//API-8
app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliedQuery = `SELECT name,reply FROM user INNER JOIN reply ON user.user_id = reply.user_id
    WHERE tweet_id = '${tweetId}';
    `;
    const repliedUsers = await database.all(getRepliedQuery);
    response.send({ replies: repliedUsers });
  }
);

//API-9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetQuery = `
        SELECT tweet,
        COUNT(DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        date_time AS dateTime 
        FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id 
        LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
        WHERE tweet.user_id = ${userId}
        GROUP BY tweet.tweet_id;
    `;
  const tweets = await database.all(getTweetQuery);
  response.send(tweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
    VALUES('${tweet}','${userId}','${dateTime}')
    `;
  await database.run(createTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const getTheTweetQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
    const tweet = await database.get(getTheTweetQuery);

    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE user_id = '${tweetId}';`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
