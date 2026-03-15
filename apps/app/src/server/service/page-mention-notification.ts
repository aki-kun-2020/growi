import type { IUser } from '@growi/core';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';

import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:service:page-mention-notification');

// Reuse the same pattern as CommentService
// https://regex101.com/r/Ztxj2j/1
const USERNAME_PATTERN = /\B@[\w@.-]+/g;

/**
 * Extract usernames from text using @mention pattern
 */
const extractMentionedUsernames = (text: string): Set<string> => {
  const matches = text.match(USERNAME_PATTERN);
  if (matches == null) {
    return new Set();
  }
  return new Set(matches.map((m) => m.slice(1)));
};

/**
 * Extract newly added @mentions from the diff between previous and current page body.
 * Only returns mentions that appear in the new body but not in the previous body.
 */
export const extractNewMentionUserIds = async (
  previousBody: string | null,
  currentBody: string,
): Promise<Types.ObjectId[]> => {
  const currentMentions = extractMentionedUsernames(currentBody);
  const previousMentions = extractMentionedUsernames(previousBody ?? '');

  // Find only newly added mentions
  const newMentions = [...currentMentions].filter(
    (username) => !previousMentions.has(username),
  );

  if (newMentions.length === 0) {
    return [];
  }

  const User = mongoose.model<IUser>('User');
  const mentionedUsers = await User.find({
    username: { $in: newMentions },
  }).select('_id');

  logger.debug('Newly mentioned users found:', {
    newMentions,
    userCount: mentionedUsers.length,
  });

  return mentionedUsers.map((user) => user._id);
};

/**
 * Get contributor (revision author) user IDs for a given page.
 */
export const getContributorUserIds = async (
  pageId: Types.ObjectId,
): Promise<Types.ObjectId[]> => {
  const Revision = mongoose.model('Revision');

  const authorIds: Types.ObjectId[] = await Revision.find({ pageId })
    .select('author')
    .distinct('author');

  return authorIds;
};
