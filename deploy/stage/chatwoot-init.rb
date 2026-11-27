# Chatwoot's first run on a stand: the administrator, the account and the Website inbox
# with Identity Validation on (spec/support.md §3.2). No secrets are arguments here.
#
#   docker compose cp chatwoot-init.rb rails:/tmp/chatwoot-init.rb
#   ADMIN_PASSWORD=... docker compose exec -T -e ADMIN_PASSWORD \
#     rails bundle exec rails runner /tmp/chatwoot-init.rb
#   docker compose cp rails:/tmp/tokens.env ./tokens.env
#
# tokens.env holds the website token (public, goes into the widget page) and the HMAC
# token (secret, becomes REMO_SUPPORT_HMAC_SECRET). Mode 600; never in git.

account = Account.find_or_create_by!(name: "Remuka")
user = User.find_or_initialize_by(email: ENV.fetch("ADMIN_EMAIL", "support@stage.remuka.ru"))
user.name = "Remuka Support"
user.password = ENV.fetch("ADMIN_PASSWORD")
user.confirmed_at ||= Time.current if user.respond_to?(:confirmed_at)
user.save!
AccountUser.find_or_create_by!(account: account, user: user) do |au|
  au.role = :administrator
end

channel = Channel::WebWidget.find_or_initialize_by(account: account)
channel.website_url = ENV.fetch("APP_ORIGIN", "https://app.stage.remuka.ru")
channel.welcome_title = "Помощь"
channel.welcome_tagline = "Напишите нам — ответит человек или помощник."
# Identity Validation is not optional: without it anyone may write as somebody else.
channel.hmac_mandatory = true
channel.hmac_token = SecureRandom.hex(24) if channel.hmac_token.blank?
channel.save!

inbox = Inbox.find_or_initialize_by(account: account, name: "Помощь в приложении")
inbox.channel = channel
inbox.save!

File.write(
  "/tmp/tokens.env",
  "WEBSITE_TOKEN=#{channel.website_token}\nHMAC_TOKEN=#{channel.hmac_token}\n",
)
puts "inbox=#{inbox.id} identity=#{channel.hmac_mandatory}"
