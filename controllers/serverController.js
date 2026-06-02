import Server from '../models/Server.js';
import User from '../models/User.js';
import Message from '../models/Message.js';
import inviteTrie from '../utils/inviteTrie.js';

// Helper to generate a unique 8-character uppercase alphanumeric invite code
const generateInviteCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

// Helper to slugify channel names
const slugifyChannelName = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // remove special chars
    .replace(/\s+/g, '-')         // replace spaces with hyphens
    .replace(/-+/g, '-');         // remove duplicate hyphens
};

/**
 * Create a new server
 * POST /api/servers
 */
export const createServer = async (req, res) => {
  try {
    const { name, icon, isPrivate, description, banner } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: 'Server name is required' });
    }

    // Generate unique invite code
    let inviteCode = generateInviteCode();
    while (inviteTrie.search(inviteCode)) {
      inviteCode = generateInviteCode();
    }

    // Default categories & channels
    const defaultCategories = [
      {
        name: 'Text Channels',
        order: 0,
        channels: [
          {
            name: 'general',
            type: 'text',
            description: 'General discussion for all members.',
            isAnnouncement: false,
            subscribers: [req.user._id]
          }
        ]
      },
      {
        name: 'Voice Channels',
        order: 1,
        channels: [
          {
            name: 'general-voice',
            type: 'voice',
            description: 'General voice room.',
            isAnnouncement: false,
            subscribers: []
          }
        ]
      }
    ];

    const server = new Server({
      name,
      icon: icon || '',
      banner: banner || '',
      description: description || '',
      owner: req.user._id,
      admins: [req.user._id],
      members: [{ user: req.user._id }],
      isPrivate: !!isPrivate,
      inviteCode,
      inviteUses: 0,
      categories: defaultCategories
    });

    await server.save();
    
    // Cache invite code in Trie
    inviteTrie.insert(inviteCode);

    res.status(201).json({ success: true, server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetch all servers current user is a member of
 * GET /api/servers
 */
export const getServers = async (req, res) => {
  try {
    const servers = await Server.find({
      'members.user': req.user._id
    })
    .populate('owner', '_id username displayName avatar')
    .populate('admins', '_id username displayName avatar')
    .populate('members.user', '_id username displayName avatar systemStatus userStatusPreference');

    res.status(200).json({ success: true, servers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetch server details by ID (with presence counters)
 * GET /api/servers/:serverId
 */
export const getServerDetails = async (req, res) => {
  try {
    const { serverId } = req.params;

    const server = await Server.findById(serverId)
      .populate('owner', '_id username displayName avatar')
      .populate('admins', '_id username displayName avatar')
      .populate('members.user', '_id username displayName avatar systemStatus userStatusPreference');

    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const isMember = server.members.some(
      (m) => m.user && m.user._id.toString() === req.user?._id.toString()
    );

    // Private server protection
    if (server.isPrivate && !isMember) {
      return res.status(403).json({ success: false, error: 'Server is private' });
    }

    // Compute online counts and presence states
    let onlineCount = 0;
    const resolvedMembers = server.members.map((m) => {
      if (!m.user) return m;

      // Presence resolution algorithm
      let resolvedStatus = 'offline';
      if (m.user.userStatusPreference === 'auto') {
        resolvedStatus = m.user.systemStatus || 'offline';
      } else {
        resolvedStatus = m.user.userStatusPreference;
      }

      if (['online', 'idle', 'dnd'].includes(resolvedStatus)) {
        onlineCount++;
      }

      return {
        ...m.toObject(),
        resolvedStatus
      };
    });

    const serverObj = server.toObject();
    serverObj.members = resolvedMembers;
    serverObj.totalMembers = server.members.length;
    serverObj.onlineCount = onlineCount;

    res.status(200).json({ success: true, server: serverObj });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Join a server via invite code
 * POST /api/servers/join/:inviteCode
 */
export const joinServerByInvite = async (req, res) => {
  try {
    const inviteCode = req.params.inviteCode.toUpperCase();

    // Fast-path Trie Check
    const existsInTrie = inviteTrie.search(inviteCode);
    if (!existsInTrie) {
      return res.status(404).json({ success: false, error: 'Invalid invite code' });
    }

    const server = await Server.findOne({ inviteCode });
    if (!server) {
      // Out of sync - remove from trie
      inviteTrie.remove(inviteCode);
      return res.status(404).json({ success: false, error: 'Invalid invite code' });
    }

    // Check if user is banned
    if (server.bannedUsers.includes(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You are banned from this server' });
    }

    // Check if already a member
    const isAlreadyMember = server.members.some(
      (m) => m.user.toString() === req.user._id.toString()
    );

    if (isAlreadyMember) {
      return res.status(200).json({ success: true, message: 'Already a member', serverId: server._id });
    }

    // Check expiration
    if (server.inviteExpiresAt && new Date() > server.inviteExpiresAt) {
      inviteTrie.remove(inviteCode);
      return res.status(410).json({ success: false, error: 'Invite code has expired' });
    }

    // Check max uses limit
    if (server.inviteMaxUses && server.inviteUses >= server.inviteMaxUses) {
      inviteTrie.remove(inviteCode);
      return res.status(410).json({ success: false, error: 'Invite code usage limit reached' });
    }

    // Join member details setup
    server.members.push({ user: req.user._id });
    server.inviteUses += 1;

    // Automatic enrollment in Announcement channels
    let defaultTextChannelId = null;
    server.categories.forEach((category) => {
      category.channels.forEach((channel) => {
        if (channel.isAnnouncement) {
          if (!channel.subscribers.includes(req.user._id)) {
            channel.subscribers.push(req.user._id);
          }
        }
        if (channel.type === 'text' && !defaultTextChannelId) {
          defaultTextChannelId = channel._id;
        }
      });
    });

    await server.save();

    // System Welcome Message creation
    if (defaultTextChannelId) {
      const systemUser = await User.findOne({ isSystem: true });
      if (systemUser) {
        const welcomeMessage = new Message({
          server: server._id,
          channel: defaultTextChannelId,
          sender: systemUser._id,
          content: `🎉 Welcome @${req.user.username} to the server! Say hello!`,
          isSystem: true
        });

        await welcomeMessage.save();

        // Broadcast message to channel room via Socket.io
        const io = req.app.get('io');
        if (io) {
          io.to(`channel_${defaultTextChannelId}`).emit('receive_message', welcomeMessage);
        }
      }
    }

    res.status(200).json({ success: true, message: 'Successfully joined server', serverId: server._id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Direct attempt to join server (without invite)
 * POST /api/servers/:serverId/join-direct
 */
export const joinServerDirect = async (req, res) => {
  try {
    const { serverId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Banned check
    if (server.bannedUsers.includes(req.user._id)) {
      return res.status(403).json({ success: false, error: 'You are banned from this server' });
    }

    // Private verification
    if (server.isPrivate) {
      return res.status(403).json({ success: false, error: 'Server is private and you cannot join!' });
    }

    // Check if already a member
    const isAlreadyMember = server.members.some(
      (m) => m.user.toString() === req.user._id.toString()
    );

    if (isAlreadyMember) {
      return res.status(200).json({ success: true, message: 'Already a member', serverId: server._id });
    }

    // Push new member
    server.members.push({ user: req.user._id });

    // Announcement channels enrollment
    let defaultTextChannelId = null;
    server.categories.forEach((category) => {
      category.channels.forEach((channel) => {
        if (channel.isAnnouncement) {
          if (!channel.subscribers.includes(req.user._id)) {
            channel.subscribers.push(req.user._id);
          }
        }
        if (channel.type === 'text' && !defaultTextChannelId) {
          defaultTextChannelId = channel._id;
        }
      });
    });

    await server.save();

    // Welcome system trigger
    if (defaultTextChannelId) {
      const systemUser = await User.findOne({ isSystem: true });
      if (systemUser) {
        const welcomeMessage = new Message({
          server: server._id,
          channel: defaultTextChannelId,
          sender: systemUser._id,
          content: `🎉 Welcome @${req.user.username} to the server! Say hello!`,
          isSystem: true
        });

        await welcomeMessage.save();

        const io = req.app.get('io');
        if (io) {
          io.to(`channel_${defaultTextChannelId}`).emit('receive_message', welcomeMessage);
        }
      }
    }

    res.status(200).json({ success: true, message: 'Successfully joined server', serverId: server._id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Leave a server
 * POST /api/servers/:serverId/leave
 */
export const leaveServer = async (req, res) => {
  try {
    const { serverId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Owner cannot leave
    if (server.owner.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, error: 'Owners cannot leave their own server' });
    }

    // Remove member and admin atomically to prevent Mongoose array reference issues
    await Server.updateOne(
      { _id: serverId },
      { 
        $pull: { 
          members: { user: req.user._id },
          admins: req.user._id 
        }
      }
    );

    // Emit socket event to notify client of left server
    const io = req.app.get('io');
    if (io) {
      io.emit('user_removed_from_server', { serverId, userId: req.user._id.toString(), action: 'left' });
    }

    res.status(200).json({ success: true, message: 'Left server successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Kick member from server
 * POST /api/servers/:serverId/kick/:userId
 */
export const kickMember = async (req, res) => {
  try {
    const { serverId, userId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Admin/Owner check
    const isOwner = server.owner.toString() === req.user._id.toString();
    const isAdmin = server.admins.some((adminId) => adminId.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Unauthorized moderator action' });
    }

    // Cannot kick owner
    if (server.owner.toString() === userId) {
      return res.status(400).json({ success: false, error: 'Cannot kick the server owner' });
    }

    // Remove member and admin atomically to prevent Mongoose array reference issues
    await Server.updateOne(
      { _id: serverId },
      { 
        $pull: { 
          members: { user: userId },
          admins: userId 
        } 
      }
    );

    const io = req.app.get('io');
    if (io) {
      // Emit to the specific user that they were kicked, using their user room if configured, or globally
      io.emit('user_removed_from_server', { serverId, userId, action: 'kicked' });
    }

    res.status(200).json({ success: true, message: 'User kicked successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Ban member from server
 * POST /api/servers/:serverId/ban/:userId
 */
export const banMember = async (req, res) => {
  try {
    const { serverId, userId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Admin/Owner check
    const isOwner = server.owner.toString() === req.user._id.toString();
    const isAdmin = server.admins.some((adminId) => adminId.toString() === req.user._id.toString());
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Unauthorized moderator action' });
    }

    // Cannot ban owner
    if (server.owner.toString() === userId) {
      return res.status(400).json({ success: false, error: 'Cannot ban the server owner' });
    }

    // Remove member & admin, and add to bannedUsers atomically
    await Server.updateOne(
      { _id: serverId },
      { 
        $pull: { 
          members: { user: userId },
          admins: userId 
        },
        $addToSet: {
          bannedUsers: userId
        }
      }
    );

    const io = req.app.get('io');
    if (io) {
      // Notify clients
      io.emit('user_removed_from_server', { serverId, userId, action: 'banned' });
    }

    res.status(200).json({ success: true, message: 'User banned successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Edit member nickname
 * PUT /api/servers/:serverId/nickname
 */
export const editMemberNickname = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { nickname } = req.body;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const memberIndex = server.members.findIndex(
      (m) => m.user.toString() === req.user._id.toString()
    );

    if (memberIndex === -1) {
      return res.status(403).json({ success: false, error: 'You are not a member of this server' });
    }

    server.members[memberIndex].nickname = nickname ? nickname.trim() : undefined;
    await server.save();

    res.status(200).json({ success: true, server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create text or voice sub-channel inside category
 * POST /api/servers/:serverId/channels
 */
export const createChannel = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name, type, description, isAnnouncement, categoryId } = req.body;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner or admins can create channels
    const isChannelAuthorized =
      server.owner.toString() === req.user._id.toString() ||
      server.admins.some(adminId => adminId.toString() === req.user._id.toString());
    if (!isChannelAuthorized) {
      return res.status(403).json({ success: false, error: 'Only the server owner or administrators can create channels' });
    }

    if (!name) {
      return res.status(400).json({ success: false, error: 'Channel name is required' });
    }

    const channelType = type || 'text';
    const channelName = channelType === 'text' ? slugifyChannelName(name) : name.trim();

    if (!channelName) {
      return res.status(400).json({ success: false, error: 'Invalid channel name' });
    }

    const newChannel = {
      name: channelName,
      type: channelType,
      description: description || '',
      isAnnouncement: !!isAnnouncement,
      subscribers: isAnnouncement ? server.members.map((m) => m.user) : [],
      mutedUsers: []
    };

    // Find category to insert into
    let category = null;
    if (categoryId) {
      category = server.categories.id(categoryId);
    } else if (server.categories.length > 0) {
      // Default to first category
      category = server.categories[0];
    }

    if (!category) {
      return res.status(404).json({ success: false, error: 'Target category not found' });
    }

    category.channels.push(newChannel);
    await server.save();

    // Retrieve the created channel (the last one pushed)
    const createdChannel = category.channels[category.channels.length - 1];

    res.status(201).json({ success: true, channel: createdChannel, server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Toggle channel subscription
 * POST /api/servers/:serverId/channels/:channelId/subscribe
 */
export const subscribeChannel = async (req, res) => {
  try {
    const { serverId, channelId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    let targetChannel = null;
    for (const cat of server.categories) {
      const ch = cat.channels.id(channelId);
      if (ch) {
        targetChannel = ch;
        break;
      }
    }

    if (!targetChannel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const userIdStr = req.user._id.toString();
    const subIndex = targetChannel.subscribers.findIndex((uid) => uid.toString() === userIdStr);

    let isSubscribed = false;
    if (subIndex > -1) {
      // Unsubscribe
      targetChannel.subscribers.splice(subIndex, 1);
    } else {
      // Subscribe
      targetChannel.subscribers.push(req.user._id);
      isSubscribed = true;
    }

    await server.save();

    res.status(200).json({ success: true, isSubscribed, channel: targetChannel });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Toggle channel mute
 * POST /api/servers/:serverId/channels/:channelId/mute
 */
export const muteChannel = async (req, res) => {
  try {
    const { serverId, channelId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    let targetChannel = null;
    for (const cat of server.categories) {
      const ch = cat.channels.id(channelId);
      if (ch) {
        targetChannel = ch;
        break;
      }
    }

    if (!targetChannel) {
      return res.status(404).json({ success: false, error: 'Channel not found' });
    }

    const userIdStr = req.user._id.toString();
    const muteIndex = targetChannel.mutedUsers.findIndex((uid) => uid.toString() === userIdStr);

    let isMuted = false;
    if (muteIndex > -1) {
      // Unmute
      targetChannel.mutedUsers.splice(muteIndex, 1);
    } else {
      // Mute
      targetChannel.mutedUsers.push(req.user._id);
      isMuted = true;
    }

    await server.save();

    res.status(200).json({ success: true, isMuted, channel: targetChannel });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Toggle category mute
 * POST /api/servers/:serverId/categories/:categoryId/mute
 */
export const muteCategory = async (req, res) => {
  try {
    const { serverId, categoryId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    const category = server.categories.id(categoryId);
    if (!category) {
      return res.status(404).json({ success: false, error: 'Category not found' });
    }

    const userIdStr = req.user._id.toString();
    const muteIndex = category.mutedUsers.findIndex((uid) => uid.toString() === userIdStr);

    let isMuted = false;
    if (muteIndex > -1) {
      // Unmute
      category.mutedUsers.splice(muteIndex, 1);
    } else {
      // Mute
      category.mutedUsers.push(req.user._id);
      isMuted = true;
    }

    await server.save();

    res.status(200).json({ success: true, isMuted, category });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Update server details (name, icon, isPrivate)
 * PUT /api/servers/:serverId
 */
export const updateServer = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name, icon, isPrivate } = req.body;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner or admins can update
    const isAuthorized = 
      server.owner.toString() === req.user._id.toString() ||
      server.admins.some(adminId => adminId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Not authorized to manage this server' });
    }

    if (name !== undefined) server.name = name;
    if (icon !== undefined) server.icon = icon;
    if (isPrivate !== undefined) server.isPrivate = !!isPrivate;

    await server.save();

    res.status(200).json({ success: true, message: 'Server updated successfully', server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Create a new category on server
 * POST /api/servers/:serverId/categories
 */
export const createCategory = async (req, res) => {
  try {
    const { serverId } = req.params;
    const { name } = req.body;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner or admins can create a category
    const isAuthorized = 
      server.owner.toString() === req.user._id.toString() ||
      server.admins.some(adminId => adminId.toString() === req.user._id.toString());

    if (!isAuthorized) {
      return res.status(403).json({ success: false, error: 'Only the server owner or administrators can create categories' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }

    const newCategory = {
      name: name.trim(),
      order: server.categories.length,
      channels: [],
      mutedUsers: []
    };

    server.categories.push(newCategory);
    await server.save();

    const createdCategory = server.categories[server.categories.length - 1];

    res.status(201).json({ success: true, category: createdCategory, server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Generate a new invite code for a server
 * POST /api/servers/invite
 */
export const generateServerInvite = async (req, res) => {
  try {
    const { serverId, maxUses, expiresInMinutes } = req.body;

    if (!serverId) {
      return res.status(400).json({ success: false, error: 'Server ID is required' });
    }

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner or admins can generate a new invite
    const isOwner = server.owner.toString() === req.user._id.toString();
    const isAdmin = server.admins.some((adminId) => adminId.toString() === req.user._id.toString());
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Only the server owner or administrators can generate invites' });
    }

    // Remove old invite from Trie cache if it exists
    if (server.inviteCode) {
      inviteTrie.remove(server.inviteCode);
    }

    // Generate unique new invite code
    let newInviteCode = generateInviteCode();
    while (inviteTrie.search(newInviteCode)) {
      newInviteCode = generateInviteCode();
    }

    // Configure invite limits
    server.inviteCode = newInviteCode;
    server.inviteUses = 0;
    server.inviteMaxUses = maxUses ? parseInt(maxUses, 10) : 0;
    
    if (expiresInMinutes && parseInt(expiresInMinutes, 10) > 0) {
      server.inviteExpiresAt = new Date(Date.now() + parseInt(expiresInMinutes, 10) * 60000);
    } else {
      server.inviteExpiresAt = undefined;
    }

    await server.save();

    // Cache new invite code in Trie
    inviteTrie.insert(newInviteCode);

    res.status(200).json({ success: true, inviteCode: server.inviteCode, server });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Delete a server — OWNER ONLY
 * DELETE /api/servers/:serverId
 */
export const deleteServer = async (req, res) => {
  try {
    const { serverId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Strictly owner-only — admins cannot delete the server
    if (server.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the server owner can delete the server' });
    }

    // Remove invite from Trie cache
    if (server.inviteCode) {
      inviteTrie.remove(server.inviteCode);
    }

    // Delete all messages belonging to this server
    await Message.deleteMany({ server: server._id });

    // Delete the server itself
    await server.deleteOne();

    // Emit socket event to notify all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('server_deleted', { serverId });
    }

    res.status(200).json({ success: true, message: 'Server deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Promote a member to admin
 * POST /api/servers/:serverId/admins/:userId
 */
export const promoteToAdmin = async (req, res) => {
  try {
    const { serverId, userId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner can promote admins
    if (server.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the server owner can promote admins' });
    }

    // Check target is a member
    const isMember = server.members.some(m => m.user.toString() === userId);
    if (!isMember) {
      return res.status(404).json({ success: false, error: 'User is not a member of this server' });
    }

    // Idempotent check
    const alreadyAdmin = server.admins.some(a => a.toString() === userId);
    if (alreadyAdmin) {
      return res.status(200).json({ success: true, message: 'User is already an admin' });
    }

    server.admins.push(userId);
    await server.save();

    res.status(200).json({ success: true, message: 'User promoted to admin' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Demote admin back to member
 * DELETE /api/servers/:serverId/admins/:userId
 */
export const demoteAdmin = async (req, res) => {
  try {
    const { serverId, userId } = req.params;

    const server = await Server.findById(serverId);
    if (!server) {
      return res.status(404).json({ success: false, error: 'Server not found' });
    }

    // Only owner can demote
    if (server.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the server owner can demote admins' });
    }

    server.admins = server.admins.filter(a => a.toString() !== userId);
    await server.save();

    res.status(200).json({ success: true, message: 'Admin demoted to member' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetch all public servers or search them by name
 * GET /api/servers/explore
 */
export const exploreServers = async (req, res) => {
  try {
    const { search } = req.query;
    const query = { isPrivate: false };
    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }
    const servers = await Server.find(query)
      .populate('owner', '_id username displayName avatar')
      .populate('members.user', '_id username displayName avatar');
    
    res.status(200).json({ success: true, servers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Fetch server summary by invite code (Public endpoint)
 * GET /api/servers/invite-details/:inviteCode
 */
export const getServerByInviteCode = async (req, res) => {
  try {
    const inviteCode = req.params.inviteCode.toUpperCase();
    const server = await Server.findOne({ inviteCode })
      .select('name icon banner description owner members')
      .populate('owner', '_id username displayName avatar');

    if (!server) {
      return res.status(404).json({ success: false, error: 'Invalid invite code' });
    }

    res.status(200).json({
      success: true,
      server: {
        _id: server._id,
        name: server.name,
        icon: server.icon,
        banner: server.banner,
        description: server.description,
        owner: server.owner,
        totalMembers: server.members.length
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

